' Agent Ops - one click: start the dashboard if needed, then open it in the browser.
Option Explicit
Dim fso, sh, here, url, i
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://localhost:4321"

Function Listening()
  Dim http
  Listening = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1500, 1500
  http.Open "GET", "http://127.0.0.1:4321/api/health", False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Or http.Status = 503 Then Listening = True
  End If
  On Error GoTo 0
End Function

If Not Listening() Then
  sh.Run "wscript.exe """ & here & "\launch.vbs""", 0, False
  ' Wait up to 60 seconds for the dashboard (or its "getting ready" page) to answer.
  For i = 1 To 60
    WScript.Sleep 1000
    If Listening() Then Exit For
  Next
End If
sh.Run url
