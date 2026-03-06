"""
Run once to create a Windows Desktop shortcut for Invoice Fetcher.
No dependencies beyond the Python standard library.
"""
import os
import subprocess
import sys


def _get_pythonw(python_exe: str) -> str:
    """Return pythonw.exe path (no console window) if it exists, else python.exe."""
    pythonw = os.path.join(os.path.dirname(python_exe), "pythonw.exe")
    return pythonw if os.path.isfile(pythonw) else python_exe


def _write_vbs(vbs_path: str, script_dir: str, python_exe: str) -> None:
    """Regenerate run_silent.vbs with the current Python interpreter path."""
    # Use Chr(34) trick to avoid cmd /c quoting issues — call pythonw directly.
    content = (
        'Set oShell = CreateObject("WScript.Shell")\n'
        'Set oFSO   = CreateObject("Scripting.FileSystemObject")\n'
        "\n"
        f'Dim appDir  : appDir  = "{script_dir}"\n'
        f'Dim pyExe   : pyExe   = "{python_exe}"\n'
        f'Dim logFile : logFile = "{script_dir}\\streamlit_launch.log"\n'
        "\n"
        "If Not oFSO.FileExists(pyExe) Then\n"
        '    MsgBox "Python not found at:" & vbCrLf & pyExe & vbCrLf & vbCrLf _\n'
        '         & "Run  python create_shortcut.py  to rebuild this launcher.", _\n'
        "           vbCritical, \"Invoice Fetcher\"\n"
        "    WScript.Quit 1\n"
        "End If\n"
        "\n"
        "Dim oLog : Set oLog = oFSO.OpenTextFile(logFile, 8, True)\n"
        "oLog.WriteLine Now() & \"  Launching: \" & pyExe\n"
        "oLog.Close\n"
        "\n"
        "oShell.CurrentDirectory = appDir\n"
        'oShell.Run Chr(34) & pyExe & Chr(34) & " -m streamlit run " _\n'
        f'         & Chr(34) & appDir & "\\app.py" & Chr(34) _\n'
        '         & " --server.headless true", _\n'
        "         0, False\n"
        "\n"
        "WScript.Sleep 6000\n"
        'oShell.Run "http://localhost:8501"\n'
    )
    with open(vbs_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Updated run_silent.vbs with Python: {python_exe}")


def create_shortcut():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    vbs_path = os.path.join(script_dir, "run_silent.vbs")

    # Always regenerate the VBS so it uses the correct Python interpreter.
    python_exe = _get_pythonw(sys.executable)
    _write_vbs(vbs_path, script_dir, python_exe)

    # Support OneDrive-redirected Desktops
    possible_desktops = [
        os.path.join(os.environ.get("USERPROFILE", ""), "Desktop"),
        os.path.join(os.environ.get("USERPROFILE", ""), "OneDrive", "Desktop"),
        os.path.join(os.environ.get("OneDrive", ""), "Desktop"),
    ]

    desktop = next((p for p in possible_desktops if p and os.path.isdir(p)), None)
    if not desktop:
        print("ERROR: Could not locate your Desktop folder.")
        sys.exit(1)

    shortcut_path = os.path.join(desktop, "Invoice Fetcher.lnk")

    # Use PowerShell COM automation — no pywin32 required
    ps_script = f"""
$WS = New-Object -ComObject WScript.Shell
$SC = $WS.CreateShortcut('{shortcut_path}')
$SC.TargetPath    = 'wscript.exe'
$SC.Arguments     = '"{vbs_path}"'
$SC.WorkingDirectory = '{script_dir}'
$SC.IconLocation  = '{script_dir}\\icon.ico'
$SC.Description   = 'Invoice Fetcher — Smart Invoice Manager'
$SC.Save()
"""

    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps_script],
        capture_output=True,
        text=True,
    )

    if result.returncode == 0:
        print(f"Done! Shortcut created at:\n  {shortcut_path}")
        print("\nDouble-click 'Invoice Fetcher' on your Desktop to launch the app.")
    else:
        print(f"ERROR creating shortcut:\n{result.stderr}")
        sys.exit(1)


if __name__ == "__main__":
    create_shortcut()
