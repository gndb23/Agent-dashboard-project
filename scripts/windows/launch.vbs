' Agent Ops - starts the dashboard in the background, with no window.
' Used by the Windows Startup shortcut and by "Agent Ops" on the desktop.
Option Explicit
Dim fso, sh, root, node
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
node = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not fso.FileExists(node) Then node = "node.exe"
sh.CurrentDirectory = root
sh.Run """" & node & """ """ & root & "\scripts\supervisor.mjs""", 0, False
