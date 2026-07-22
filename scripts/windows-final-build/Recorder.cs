using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

// A deliberately small Windows-only reader. Directory walking discovers names;
// all trust decisions, identity reads, and hashing happen on no-follow handles.
internal static class Recorder {
  const uint READ = 0x80000000, SHARE = 0x7, OPEN = 3;
  const uint BACKUP = 0x02000000, OPEN_REPARSE = 0x00200000, SEQUENTIAL = 0x08000000;
  const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
  static readonly HashSet<string> Devices = new(StringComparer.OrdinalIgnoreCase) {"CON","PRN","AUX","NUL","COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8","COM9","LPT1","LPT2","LPT3","LPT4","LPT5","LPT6","LPT7","LPT8","LPT9"};

  [StructLayout(LayoutKind.Sequential)] struct Info { public uint attr; public System.Runtime.InteropServices.ComTypes.FILETIME c,a,w; public uint vol, sizeHi,sizeLo, links,indexHi,indexLo; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct StreamData { public long size; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=296)] public string name; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string n,uint a,uint s,IntPtr p,uint d,uint f,IntPtr t);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr FindFirstStreamW(string n,int l,out StreamData d,uint f);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool FindNextStreamW(IntPtr h,out StreamData d);
  [DllImport("kernel32.dll")] static extern bool FindClose(IntPtr h);

  sealed class Identity { public string volume_serial {get;set;}=""; public string file_id {get;set;}=""; public string last_write_utc {get;set;}=""; public uint links {get;set;} }
  sealed class Row { public string category {get;set;}=""; public string logical_path {get;set;}=""; public long bytes {get;set;} public string sha256 {get;set;}=""; public Identity identity_before {get;set;}=new(); public Identity identity_after {get;set;}=new(); }
  sealed class Result { public Identity root_identity {get;set;}=new(); public List<Row> rows {get;set;}=new(); }

  static string J(string value) { return "\""+value.Replace("\\","\\\\").Replace("\"","\\\"")+"\""; }
  static string IdentityJson(Identity i) { return $"{{\"volume_serial\":{J(i.volume_serial)},\"file_id\":{J(i.file_id)},\"last_write_utc\":{J(i.last_write_utc)},\"links\":{i.links}}}"; }
  static string ResultJson(Result result) {
    var rows=result.rows.Select(r=>$"{{\"category\":{J(r.category)},\"logical_path\":{J(r.logical_path)},\"bytes\":{r.bytes},\"sha256\":{J(r.sha256)},\"identity_before\":{IdentityJson(r.identity_before)},\"identity_after\":{IdentityJson(r.identity_after)}}}");
    return $"{{\"root_identity\":{IdentityJson(result.root_identity)},\"rows\":[{String.Join(",",rows)}]}}";
  }

  static void Die(string m) { Console.Error.WriteLine(m); Environment.Exit(2); }
  static SafeFileHandle Open(string path,bool directory=false,uint share=SHARE) {
    var h=CreateFileW(path,READ,share,IntPtr.Zero,OPEN,OPEN_REPARSE|(directory?BACKUP:SEQUENTIAL),IntPtr.Zero);
    if(h.IsInvalid) throw new IOException($"open failed ({Marshal.GetLastWin32Error()}): {path}");
    return h;
  }
  static Identity Id(SafeFileHandle h) {
    if(!GetFileInformationByHandle(h,out var i)) throw new IOException($"identity failed: {Marshal.GetLastWin32Error()}");
    if((i.attr&FILE_ATTRIBUTE_REPARSE_POINT)!=0) throw new IOException("reparse point forbidden");
    var ticks=((long)i.w.dwHighDateTime<<32)|(uint)i.w.dwLowDateTime;
    return new Identity { volume_serial=i.vol.ToString("x8"), file_id=$"{i.indexHi:x8}{i.indexLo:x8}", last_write_utc=DateTime.FromFileTimeUtc(ticks).ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'",CultureInfo.InvariantCulture), links=i.links };
  }
  static long Length(SafeFileHandle h){if(!GetFileInformationByHandle(h,out var i))throw new IOException($"length failed: {Marshal.GetLastWin32Error()}");return ((long)i.sizeHi<<32)|i.sizeLo;}
  static void SafeName(string rel,HashSet<string> seen) {
    if(rel!=rel.Normalize(NormalizationForm.FormC) || rel.Any(c=>c<32 || c==127 || Char.IsSurrogate(c)) || rel.Contains('\\') || rel.StartsWith("/") || rel.Contains(':')) throw new IOException($"unsafe path: {rel}");
    foreach(var p in rel.Split('/')) if(p.Length==0||p=="."||p==".."||p.EndsWith(".")||p.EndsWith(" ")||Devices.Contains(p.Split('.')[0])) throw new IOException($"unsafe path: {rel}");
    var key=rel.Normalize(NormalizationForm.FormC).ToUpperInvariant();
    if(!seen.Add(key)) throw new IOException($"case/NFC collision: {rel}");
  }
  static void NoStreams(string path) {
    var h=FindFirstStreamW(path,0,out var d,0);
    if(h==new IntPtr(-1)) throw new IOException($"stream enumeration failed ({Marshal.GetLastWin32Error()}): {path}");
    try { int count=0; do { count++; if(d.name!="::$DATA") throw new IOException($"alternate stream forbidden: {path}{d.name}"); } while(FindNextStreamW(h,out d)); if(count!=1) throw new IOException($"unexpected streams: {path}"); }
    finally { FindClose(h); }
  }
  static string Hash(SafeFileHandle handle) {
    using var stream=new FileStream(handle.DangerousGetHandle(),FileAccess.Read,false,1<<20,false);
    using var hash=SHA256.Create();
    return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-","").ToLowerInvariant();
  }
  static List<string> SafeWalk(string root) {
    var files=new List<string>();var dirs=new Stack<string>();dirs.Push(root);
    while(dirs.Count>0){var dir=dirs.Pop();foreach(var path in Directory.EnumerateFileSystemEntries(dir,"*",SearchOption.TopDirectoryOnly)){
      var attr=File.GetAttributes(path);if((attr&FileAttributes.ReparsePoint)!=0)throw new IOException($"reparse point forbidden: {path}");
      if((attr&FileAttributes.Directory)!=0){using var dh=Open(path,true);Id(dh);dirs.Push(path);}else files.Add(path);
    }}
    files.Sort(StringComparer.Ordinal);return files;
  }
  static string Relative(string root,string file) {
    var prefix=root.EndsWith(Path.DirectorySeparatorChar.ToString())?root:root+Path.DirectorySeparatorChar;
    return Uri.UnescapeDataString(new Uri(prefix).MakeRelativeUri(new Uri(file)).ToString()).Replace('\\','/');
  }
  static Result Inventory(string root,string category) {
    root=Path.GetFullPath(root); if(!Directory.Exists(root)) throw new DirectoryNotFoundException(root);
    using var rootHandle=Open(root,true); var result=new Result{root_identity=Id(rootHandle)};
    var seen=new HashSet<string>(StringComparer.Ordinal);
    foreach(var path in SafeWalk(root)) {
      var rel=Relative(root,path); SafeName(rel,seen);
      var attr=File.GetAttributes(path); if((attr&FileAttributes.ReparsePoint)!=0) throw new IOException($"reparse point forbidden: {rel}");
      NoStreams(path); using var h=Open(path); var before=Id(h); if(before.links!=1) throw new IOException($"hard link forbidden: {rel}");
      var bytes=Length(h); var digest=Hash(h); var after=Id(h);
      if(IdentityJson(before)!=IdentityJson(after) || Length(h)!=bytes) throw new IOException($"file changed while hashing: {rel}");
      result.rows.Add(new Row{category=category,logical_path=rel,bytes=bytes,sha256=digest,identity_before=before,identity_after=after});
    }
    return result;
  }
  static Result InventoryList(string root,string listPath,string category) {
    root=Path.GetFullPath(root); using var rootHandle=Open(root,true); var result=new Result{root_identity=Id(rootHandle)};
    var seen=new HashSet<string>(StringComparer.Ordinal);
    foreach(var raw in File.ReadAllLines(listPath,new UTF8Encoding(false)).Where(x=>x.Length>0).OrderBy(x=>x,StringComparer.Ordinal)) {
      var rel=raw.Replace('\\','/'); SafeName(rel,seen); var path=Path.GetFullPath(Path.Combine(root,rel.Replace('/',Path.DirectorySeparatorChar)));
      if(!path.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)) throw new IOException($"path escaped root: {rel}");
      var attr=File.GetAttributes(path); if((attr&FileAttributes.ReparsePoint)!=0||(attr&FileAttributes.Directory)!=0) throw new IOException($"non-regular input forbidden: {rel}");
      NoStreams(path); using var h=Open(path); var before=Id(h); if(before.links!=1) throw new IOException($"hard link forbidden: {rel}");
      var bytes=Length(h); var digest=Hash(h); var after=Id(h);
      if(IdentityJson(before)!=IdentityJson(after)||Length(h)!=bytes) throw new IOException($"file changed while hashing: {rel}");
      result.rows.Add(new Row{category=category,logical_path=rel,bytes=bytes,sha256=digest,identity_before=before,identity_after=after});
    }
    return result;
  }
  static Result GuardList(string root,string listPath,string category,string readyPath,string releasePath) {
    root=Path.GetFullPath(root); using var rootHandle=Open(root,true,1); var result=new Result{root_identity=Id(rootHandle)};
    var seen=new HashSet<string>(StringComparer.Ordinal); var held=new List<Tuple<string,SafeFileHandle,Row>>();
    try {
      foreach(var raw in File.ReadAllLines(listPath,new UTF8Encoding(false)).Where(x=>x.Length>0).OrderBy(x=>x,StringComparer.Ordinal)) {
        var rel=raw.Replace('\\','/'); SafeName(rel,seen); var path=Path.GetFullPath(Path.Combine(root,rel.Replace('/',Path.DirectorySeparatorChar)));
        if(!path.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)) throw new IOException($"path escaped root: {rel}");
        NoStreams(path); var h=Open(path,false,1); var before=Id(h); if(before.links!=1) throw new IOException($"hard link forbidden: {rel}");
        var bytes=Length(h); var digest=Hash(h); held.Add(Tuple.Create(path,h,new Row{category=category,logical_path=rel,bytes=bytes,sha256=digest,identity_before=before,identity_after=before}));
      }
      File.WriteAllText(readyPath,"ready",new UTF8Encoding(false));
      var deadline=DateTime.UtcNow.AddHours(2); while(!File.Exists(releasePath)){if(DateTime.UtcNow>deadline)throw new IOException("guard release timeout");Thread.Sleep(50);}
      foreach(var item in held){var row=item.Item3;var after=Id(item.Item2);var digest=Hash(item.Item2);NoStreams(item.Item1);if(IdentityJson(row.identity_before)!=IdentityJson(after)||row.sha256!=digest||Length(item.Item2)!=row.bytes)throw new IOException($"guarded input changed: {row.logical_path}");row.identity_after=after;result.rows.Add(row);}
      return result;
    } finally { foreach(var item in held)item.Item2.Dispose(); }
  }
  static Result GuardFile(string file,string logical,string category,string readyPath,string releasePath) {
    file=Path.GetFullPath(file);var seen=new HashSet<string>(StringComparer.Ordinal);SafeName(logical,seen);
    var parent=Path.GetDirectoryName(file);using var rootHandle=Open(parent,true,1);var result=new Result{root_identity=Id(rootHandle)};
    NoStreams(file);using var h=Open(file,false,1);var before=Id(h);if(before.links!=1)throw new IOException($"hard link forbidden: {logical}");
    var bytes=Length(h);var digest=Hash(h);File.WriteAllText(readyPath,"ready",new UTF8Encoding(false));
    var deadline=DateTime.UtcNow.AddHours(2);while(!File.Exists(releasePath)){if(DateTime.UtcNow>deadline)throw new IOException("guard release timeout");Thread.Sleep(50);}
    var after=Id(h);var afterDigest=Hash(h);NoStreams(file);if(IdentityJson(before)!=IdentityJson(after)||digest!=afterDigest||Length(h)!=bytes)throw new IOException($"guarded file changed: {logical}");
    result.rows.Add(new Row{category=category,logical_path=logical,bytes=bytes,sha256=digest,identity_before=before,identity_after=after});return result;
  }
  static Result InventoryFile(string file,string logical,string category) {
    file=Path.GetFullPath(file);var seen=new HashSet<string>(StringComparer.Ordinal);SafeName(logical,seen);
    using var rootHandle=Open(Path.GetDirectoryName(file),true);var result=new Result{root_identity=Id(rootHandle)};
    NoStreams(file);using var h=Open(file);var before=Id(h);if(before.links!=1)throw new IOException($"hard link forbidden: {logical}");
    var bytes=Length(h);var digest=Hash(h);var after=Id(h);if(IdentityJson(before)!=IdentityJson(after)||Length(h)!=bytes)throw new IOException($"file changed while hashing: {logical}");
    result.rows.Add(new Row{category=category,logical_path=logical,bytes=bytes,sha256=digest,identity_before=before,identity_after=after});return result;
  }
  public static int Main(string[] args) {
    try {
      if(args.Length==1&&args[0]=="--version"){Console.WriteLine("aph-native-recorder-v2");return 0;}
      bool guard=args[0]=="guard-list",guardFile=args[0]=="guard-file",inventoryFile=args[0]=="inventory-file",list=args[0]=="inventory-list";
      if((guard&&args.Length!=7)||(guardFile&&args.Length!=7)||(inventoryFile&&args.Length!=5)||(list&&args.Length!=5)||(!guard&&!guardFile&&!inventoryFile&&!list&&(args[0]!="inventory"||args.Length!=4))) Die("usage: recorder inventory <root> <category> <output> | inventory-file <file> <logical> <category> <output> | inventory-list <root> <list> <category> <output> | guard-list <root> <list> <category> <output> <ready> <release> | guard-file <file> <logical> <category> <output> <ready> <release>");
      var output=Path.GetFullPath(args[guard||guardFile||inventoryFile||list?4:3]); if(File.Exists(output)) throw new IOException("recorder output already exists");
      var json=ResultJson(guard?GuardList(args[1],args[2],args[3],args[5],args[6]):guardFile?GuardFile(args[1],args[2],args[3],args[5],args[6]):inventoryFile?InventoryFile(args[1],args[2],args[3]):list?InventoryList(args[1],args[2],args[3]):Inventory(args[1],args[2]));
      File.WriteAllText(output,json,new UTF8Encoding(false)); return 0;
    } catch(Exception e) { Console.Error.WriteLine(e.Message); return 2; }
  }
}
