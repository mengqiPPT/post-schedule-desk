using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;

internal static class PasteHelper
{
    private const uint KeyUp = 0x0002;
    private const uint MouseLeftDown = 0x0002;
    private const uint MouseLeftUp = 0x0004;
    private const ushort VirtualKeyControl = 0x11;
    private const ushort VirtualKeyV = 0x56;
    private const uint GetRoot = 2;
    private const int RestoreWindow = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(Point point);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr window, uint flags);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point point);

    private static void EnableDpiAwareness()
    {
        try
        {
            if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware();
        }
        catch
        {
            try { SetProcessDPIAware(); } catch { }
        }
    }

    private static bool Paste()
    {
        keybd_event((byte)VirtualKeyControl, 0, 0, UIntPtr.Zero);
        keybd_event((byte)VirtualKeyV, 0, 0, UIntPtr.Zero);
        keybd_event((byte)VirtualKeyV, 0, KeyUp, UIntPtr.Zero);
        keybd_event((byte)VirtualKeyControl, 0, KeyUp, UIntPtr.Zero);
        return true;
    }

    private static bool ClickAt(int x, int y)
    {
        if (!SetCursorPos(x, y)) return false;
        Thread.Sleep(120);
        Point point = new Point { X = x, Y = y };
        IntPtr target = WindowFromPoint(point);
        IntPtr root = target == IntPtr.Zero ? IntPtr.Zero : GetAncestor(target, GetRoot);
        if (root != IntPtr.Zero)
        {
            if (IsIconic(root)) ShowWindow(root, RestoreWindow);
            SetForegroundWindow(root);
        }
        Thread.Sleep(650);
        if (!SetCursorPos(x, y)) return false;
        Thread.Sleep(120);
        mouse_event(MouseLeftDown, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(55);
        mouse_event(MouseLeftUp, 0, 0, 0, UIntPtr.Zero);
        return true;
    }

    private static bool TryPoint(string[] args, out int x, out int y)
    {
        x = 0;
        y = 0;
        return args.Length >= 3 && int.TryParse(args[1], out x) && int.TryParse(args[2], out y);
    }

    private static bool InvokeNamedControlAt(int x, int y, string wantedName)
    {
        Point point = new Point { X = x, Y = y };
        IntPtr target = WindowFromPoint(point);
        IntPtr rootWindow = target == IntPtr.Zero ? IntPtr.Zero : GetAncestor(target, GetRoot);
        if (rootWindow == IntPtr.Zero || String.IsNullOrWhiteSpace(wantedName))
        {
            Console.Error.WriteLine("UIA_NO_WINDOW_AT=" + x + "," + y);
            return false;
        }

        if (IsIconic(rootWindow)) ShowWindow(rootWindow, RestoreWindow);
        SetForegroundWindow(rootWindow);
        Thread.Sleep(500);

        try
        {
            AutomationElement root = AutomationElement.FromHandle(rootWindow);
            AutomationElementCollection elements = root.FindAll(TreeScope.Descendants, Condition.TrueCondition);
            Console.Error.WriteLine("UIA_ROOT=" + root.Current.Name + "; COUNT=" + elements.Count);
            AutomationElement partialMatch = null;
            for (int index = 0; index < elements.Count; index++)
            {
                AutomationElement element = elements[index];
                string name = element.Current.Name == null ? String.Empty : element.Current.Name.Trim();
                if (name.Length == 0 || element.Current.IsOffscreen || !element.Current.IsEnabled) continue;
                object rawPattern;
                if (!element.TryGetCurrentPattern(InvokePattern.Pattern, out rawPattern)) continue;
                if (String.Equals(name, wantedName, StringComparison.OrdinalIgnoreCase))
                {
                    ((InvokePattern)rawPattern).Invoke();
                    return true;
                }
                if (partialMatch == null && name.IndexOf(wantedName, StringComparison.OrdinalIgnoreCase) >= 0) partialMatch = element;
            }

            if (partialMatch != null)
            {
                object rawPattern;
                if (partialMatch.TryGetCurrentPattern(InvokePattern.Pattern, out rawPattern))
                {
                    ((InvokePattern)rawPattern).Invoke();
                    return true;
                }
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("UIA_ERROR=" + error.Message);
            return false;
        }
        Console.Error.WriteLine("UIA_TARGET_NOT_FOUND=" + wantedName);
        return false;
    }

    public static int Main(string[] args)
    {
        EnableDpiAwareness();
        if (args.Length == 1 && args[0] == "diagnose")
        {
            Point cursor;
            GetCursorPos(out cursor);
            Console.WriteLine(GetSystemMetrics(0) + "," + GetSystemMetrics(1) + ";" + cursor.X + "," + cursor.Y);
            return 0;
        }
        if (args.Length == 0) return Paste() ? 0 : 1;

        int x;
        int y;
        if (args[0] == "click" && TryPoint(args, out x, out y))
        {
            return ClickAt(x, y) ? 0 : 1;
        }

        if (args[0] == "click-paste" && TryPoint(args, out x, out y))
        {
            if (!ClickAt(x, y)) return 1;
            Thread.Sleep(120);
            return Paste() ? 0 : 1;
        }

        if (args[0] == "invoke-at" && args.Length >= 4 && TryPoint(args, out x, out y))
        {
            return InvokeNamedControlAt(x, y, args[3]) ? 0 : 1;
        }

        return 2;
    }
}
