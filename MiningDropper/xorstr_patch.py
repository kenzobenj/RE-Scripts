# Checks for XORed strings from the .data section in native functions (start with Java_) 
# Calculates the XORed value and patches the .data section
# Stores the result in a new file <filename>_patched.bndb although the changes also affect the currently opened file

from binaryninja import HighLevelILOperation as Op

def processFunction(processed, func, data_start, data_end): 
    print(f'Processing {func.name}')  
    for block in func.hlil:        
        for insn in block:
            #print(f'{hex(insn.address)} : {str(insn.operation)}')
            if insn.operation == Op.HLIL_ASSIGN:
                if insn.src.operation == Op.HLIL_XOR or insn.src.operation == Op.HLIL_NOT:
                    dest = insn.dest
                    xor_exp = insn.src
                    if dest.operation in (Op.HLIL_VAR, Op.HLIL_VAR_SSA):
                        dest_name = dest.src.name                                            
                    else:
                        dest_name = str(dest)   
                    if not dest_name.startswith('data_'):
                        print(f'Skipping XOR op targeting {dest_name} @ {hex(insn.address)}')
                        continue
                    dest_address = int(dest_name.replace('data_', ''), 16)
                    if dest_address > data_end or dest_address < data_start:
                        continue
                    if insn.src.operation == Op.HLIL_NOT:
                        xor_key = 0xff
                    else:
                        left = xor_exp.left
                        right = xor_exp.right                    
                        if left.operation == Op.HLIL_CONST:
                            xor_key = left.constant
                        elif right.operation == Op.HLIL_CONST:
                            xor_key = right.constant
                        else:
                            xor_key = None 
                    #print(f'{hex(insn.address)}: DEST: {dest_name} @ {hex(dest_address)}, XOR: {hex(xor_key)}')
                    processed[dest_address] = xor_key
                    


            
                

processed = {}
data_section = bv.get_section_by_name(".data")
if data_section:
    data_start = data_section.start
    data_end = data_section.end
else:
    raise Exception('Could not find .data section.')

# Fix most of the HLIL weirdness 
index = data_start 
while index < data_end:
    bv.define_user_data_var(index, 'char')
    index += 1
bv.update_analysis_and_wait()
print(f'Data redefined to individual chars from {hex(data_start)} to {hex(data_end)}')  

# Find and calculate all of the XORs
for func in bv.functions:
    if func.name.startswith('Java_'):
        processFunction(processed, func, data_start, data_end)
encrypted_data = bv.read(data_start, data_end - data_start)    
decrypted_data = bytearray(len(encrypted_data))
index = 0
while index < len(encrypted_data):
    decrypted_data[index] = encrypted_data[index]
    index += 1
for k, v in sorted(processed.items()):
    try:
        index = k - data_start 
        decrypted_data[index] = encrypted_data[index] ^ v
    except IndexError:
        print(f'BAD INDEX: {index}')
print(decrypted_data)

index = data_start 
while index <= data_end:
    bv.undefine_user_data_var(index)
    index += 1
bv.update_analysis_and_wait()

# Create a new BNDB file with the patched data
patch = f'{bv.file.filename}_patched.bndb'

bv.write(data_start, decrypted_data)
bv.create_database(patch)
print('Saved patched DB to ' + patch)
    
        
        
