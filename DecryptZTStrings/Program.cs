using System;
using System.Collections.Generic;
using dnlib.DotNet;
using dnlib.DotNet.Emit;
using System.Text.Json;
using System.Diagnostics;

class Program {
    static void Main(string[] args) {
        var results = new Dictionary<string, List<string>>();
        if (args.Length == 0) {
            Console.WriteLine("Usage: DecryptZTStrings <assembly>");
            return;
        }
        string path = args[0];
		var fieldData = new Dictionary<FieldDef, byte[]>();
		List<string> decryptedStrings = new();
        var mod = ModuleDefMD.Load(path);
        foreach (var type in mod.GetTypes()) {
			//Get all of the HasFieldRVA fields
            foreach (var field in type.Fields) {
                if (field.HasFieldRVA) {
                    var data = field.InitialValue ?? new byte[0];
					fieldData[field] = field.InitialValue;
                }
            }			
        }
		Debug.WriteLine($"Found {fieldData.Count} fields with RVA data.");
		foreach (var type in mod.GetTypes()) {			
			foreach (var method in type.Methods)
				if(method.HasBody) {									
					var instrs = method.Body.Instructions;
                    for (int i = 0; i < instrs.Count; i++) {
                        var instr = instrs[i];
                        // Found a potential decryption sequence
                        if ((instr.OpCode == OpCodes.Ldsflda || instr.OpCode == OpCodes.Ldsfld) && instr.Operand is FieldDef field && fieldData.ContainsKey(field)) {                            
                            // Walk backward to start of block
                            int start = i;
                            var isArray = false;
                            while (start > 0)
                            {
                                var prev = instrs[start - 1];
                                if (prev.OpCode == OpCodes.Newarr) {
                                    isArray = true;
                                    break;
                                }
                                start--;
                            }
                            if (!isArray) {                                
                                continue;
                            }
                            if (start - 2 <= 0 || instrs[start - 2].OpCode != OpCodes.Ldc_I4) {                                
                                continue;
                            }
                            int strLen = (int)instrs[start - 2].Operand;
                            //var xorCount = 0;
                            byte? fieldVal = null;

                            // Emulate forward XOR sequence
                            var chars = new List<char>();
                            int j = start;
                            while (j < instrs.Count) {
                                var cInstr = instrs[j];

                                if (cInstr.OpCode == OpCodes.Ldsflda || cInstr.OpCode == OpCodes.Ldsfld) {
                                    if (fieldVal != null) {
                                        Debug.WriteLine($"Uh oh. {method.FullName} is XORing two HasFieldRVA values, I did not prepare for this.");
                                        j += 1;
                                        break;
                                    }
                                    var f = cInstr.Operand;
                                    if (f is FieldDef && fieldData.ContainsKey((FieldDef)f)) {
                                        // Prev instruction is usually Ldc_I4 index
                                        int index = 0;
                                        if (j - 1 >= 0 && instrs[j - 1].OpCode == OpCodes.Ldc_I4) {
                                            index = (int)instrs[j - 1].Operand;                              
                                        } else {
                                            Debug.WriteLine($"Uh oh. {method.FullName} didn't find index before {cInstr.OpCode} instruction.");
                                            j += 1;
                                            break;
                                        }                                                  
                                        fieldVal = fieldData[(FieldDef)f][index];
                                        j += 1;                                        
                                    } else {
                                        Debug.WriteLine($"Uh oh. {method.FullName} is referencing a field I did not account for: {((FieldDef)f).Name}");
                                        j += 1;
                                        break;
                                    }
                                } else if (cInstr.OpCode == OpCodes.Stelem_I2) {
                                    var val = -1;
                                    if (j - 1 >= 0 && instrs[j - 1].OpCode == OpCodes.Ldc_I4_S) {
                                        val = (sbyte)instrs[j - 1].Operand;
                                    } else {
                                        Debug.WriteLine($"Uh oh. {method.FullName} did not find stelem argument.");
                                        j += 1;
                                        break;
                                    }
                                    chars.Add((char)val);
                                    fieldVal = null;
                                    j += 1;                                
                                } else if (cInstr.OpCode == OpCodes.Xor) {
                                    //xorCount += 1;
                                    int xorVal1 = -1;
                                    if (j - 1 >= 0 && instrs[j - 1].OpCode == OpCodes.Ldc_I4) {
                                        xorVal1 = (int)instrs[j - 1].Operand;
                                    } else {
                                        Debug.WriteLine($"Uh oh. {method.FullName} did not find first XOR argument.");
                                        j += 1;
                                        break;
                                    }
                                    if (fieldVal != null) {
                                        chars.Add((char)(fieldVal ^ xorVal1));
                                    } else {
                                        int xorVal2 = -1;
                                        if (j - 2 >= 0 && instrs[j - 2].OpCode == OpCodes.Ldc_I4) {
                                            xorVal2 = (int)instrs[j - 2].Operand;
                                        } else {
                                            Debug.WriteLine($"Uh oh. {method.FullName} did not find second XOR argument.");
                                            j += 1;
                                            break;
                                        } 
                                        chars.Add((char)(xorVal2 ^ xorVal1));
                                    }
                                    fieldVal = null;
                                    j += 2; //skipping the stelem after the xor
                                    if (chars.Count == strLen) {
                                        break;
                                    }
                                } else {
                                    j += 1;
                                }                                                                
                            }

                            if (chars.Count > 0)
                            {
                                string s = new string(chars.ToArray());
                                string methodKey = $"{method.DeclaringType.FullName}.{method.Name}";
                                if (!results.ContainsKey(methodKey))
                                    results[methodKey] = new List<string>();
                                results[methodKey].Add(s);
                                //Debug.WriteLine($"[{method.DeclaringType.FullName}.{method.Name}] Decrypted string: {s}");
                            }
                            // Continue from end of block
                            fieldVal = null;                            
                            i = Math.Max(i+1, j);
                        }
                    }
                }
        }
        string json = JsonSerializer.Serialize(
            results,
            DumpJsonContext.Default.DictionaryStringListString
        );        
        Console.WriteLine(json);        
        //File.WriteAllText("decrypted_strings.json", json);

    }
}