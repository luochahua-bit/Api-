Set objShell = CreateObject("WScript.Shell")
objShell.CurrentDirectory = "C:\Users\Luo\Desktop\中转站"
objShell.Run "npx localtunnel --port 3000", 0, False
