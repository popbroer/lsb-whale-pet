Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = baseDir & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(exe) Then
  MsgBox "没找到 Electron，请先在项目目录执行 npm install。", 48, "鲸鱼娘"
  WScript.Quit
End If
sh.CurrentDirectory = baseDir
sh.Run """" & exe & """ """ & baseDir & """", 0, False
