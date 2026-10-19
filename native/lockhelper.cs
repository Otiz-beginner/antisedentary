// lockhelper.exe --max-seconds N
// 鎖定休息時擋住滑鼠和鍵盤（spec §4.3）。
// 安全保險：超過 N 秒、stdin 關閉（父行程死掉）或收到 STOP 都會立刻結束；行程結束時 Windows 會自動移除 hook。
// Ctrl+Alt+Shift+M（開會模式）會在 stdout 印出 MEETING。
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

static class LockHelper
{
    const int WH_KEYBOARD_LL = 13;
    const int WH_MOUSE_LL = 14;
    const int WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105;
    const int WM_LBUTTONUP = 0x0202, WM_RBUTTONUP = 0x0205, WM_MBUTTONUP = 0x0208, WM_XBUTTONUP = 0x020C;
    const int VK_M = 0x4D;

    delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public IntPtr extra; }

    [StructLayout(LayoutKind.Sequential)]
    struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookEx(int idHook, HookProc fn, IntPtr hMod, uint threadId);
    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetModuleHandle(string name);

    // delegate 要一直被參照，否則會被 GC 回收
    static HookProc keyboardProc = KeyboardHook;
    static HookProc mouseProc = MouseHook;
    static bool ctrl, alt, shift;
    static StreamWriter stdout;
    static readonly object writeLock = new object();

    static void Send(string line)
    {
        lock (writeLock) { stdout.WriteLine(line); stdout.Flush(); }
    }

    static IntPtr KeyboardHook(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0) return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        int msg = wParam.ToInt32();
        uint vk = ((KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT))).vkCode;
        bool down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        bool up = msg == WM_KEYUP || msg == WM_SYSKEYUP;

        // 被吞掉的按鍵不會更新 GetAsyncKeyState，所以自己追蹤修飾鍵
        if (vk == 0x11 || vk == 0xA2 || vk == 0xA3) ctrl = down || (!up && ctrl);
        if (vk == 0x12 || vk == 0xA4 || vk == 0xA5) alt = down || (!up && alt);
        if (vk == 0x10 || vk == 0xA0 || vk == 0xA1) shift = down || (!up && shift);
        if (down && vk == VK_M && ctrl && alt && shift) ThreadPool.QueueUserWorkItem(_ => Send("MEETING"));

        // 放開按鍵的事件放行：鎖定前已經按住的鍵，解鎖後才不會卡住
        if (up) return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        return (IntPtr)1;
    }

    static IntPtr MouseHook(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0) return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        int msg = wParam.ToInt32();
        if (msg == WM_LBUTTONUP || msg == WM_RBUTTONUP || msg == WM_MBUTTONUP || msg == WM_XBUTTONUP)
            return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        return (IntPtr)1;
    }

    static int Main(string[] args)
    {
        int maxSeconds = 185;
        for (int i = 0; i + 1 < args.Length; i++)
            if (args[i] == "--max-seconds") int.TryParse(args[i + 1], out maxSeconds);
        if (maxSeconds <= 0 || maxSeconds > 600) maxSeconds = 185;

        stdout = new StreamWriter(Console.OpenStandardOutput());

        // 安全保險一：時間上限
        var deadline = new Timer(_ => Environment.Exit(0), null, maxSeconds * 1000, Timeout.Infinite);

        // 安全保險二：stdin 關閉（父行程結束）或收到 STOP
        var reader = new Thread(() =>
        {
            try
            {
                var stdin = new StreamReader(Console.OpenStandardInput());
                string line;
                while ((line = stdin.ReadLine()) != null)
                    if (line.Trim() == "STOP") break;
            }
            catch { }
            Environment.Exit(0);
        });
        reader.IsBackground = true;
        reader.Start();

        IntPtr module = GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName);
        if (SetWindowsHookEx(WH_KEYBOARD_LL, keyboardProc, module, 0) == IntPtr.Zero) return 1;
        if (SetWindowsHookEx(WH_MOUSE_LL, mouseProc, module, 0) == IntPtr.Zero) return 1;
        Send("READY");

        MSG m;
        while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
        GC.KeepAlive(deadline);
        return 0;
    }
}
