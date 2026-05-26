Set objShell = CreateObject("WScript.Shell")
objShell.CurrentDirectory = "C:\Users\Luo\Desktop\中转站"
objShell.Run "node src/index.js", 0, False
