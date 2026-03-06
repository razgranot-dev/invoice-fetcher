Set oShell = CreateObject("WScript.Shell")
Set oFSO   = CreateObject("Scripting.FileSystemObject")

Dim appDir  : appDir  = "C:\Users\razg\invoice-fetcher"
Dim pyExe   : pyExe   = "C:\Users\razg\AppData\Local\Python\pythoncore-3.14-64\pythonw.exe"
Dim logFile : logFile = "C:\Users\razg\invoice-fetcher\streamlit_launch.log"

If Not oFSO.FileExists(pyExe) Then
    MsgBox "Python not found at:" & vbCrLf & pyExe & vbCrLf & vbCrLf _
         & "Run  python create_shortcut.py  to rebuild this launcher.", _
           vbCritical, "Invoice Fetcher"
    WScript.Quit 1
End If

Dim oLog : Set oLog = oFSO.OpenTextFile(logFile, 8, True)
oLog.WriteLine Now() & "  Launching: " & pyExe
oLog.Close

oShell.CurrentDirectory = appDir
oShell.Run Chr(34) & pyExe & Chr(34) & " -m streamlit run " _
         & Chr(34) & appDir & "\app.py" & Chr(34) _
         & " --server.headless true", _
         0, False

WScript.Sleep 6000
oShell.Run "http://localhost:8501"
