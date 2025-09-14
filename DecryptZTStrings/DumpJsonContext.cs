using System.Text.Json.Serialization;
using System.Collections.Generic;

[JsonSourceGenerationOptions(WriteIndented = true)]
[JsonSerializable(typeof(Dictionary<string, List<string>>))]
internal partial class DumpJsonContext : JsonSerializerContext { }