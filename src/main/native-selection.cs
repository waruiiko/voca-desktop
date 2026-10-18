using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

// Native UI Automation COM avoids the legacy UIAutomationClient.dll
// RawTextRange_GetText marshaller, which can terminate the helper with an AV.
// Interface order and GUIDs follow the Windows SDK UIAutomationClient.h:
// https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/UIAutomationClient.h
public sealed class VocaNativeSelectionResult
{
    public string status { get; set; }
    public string text { get; set; }
    public string stage { get; set; }
    public int candidateCount { get; set; }
}

public static class VocaNativeSelection
{
    private const int TextPatternId = 10014;
    private const int IsPasswordPropertyId = 30019;
    private const int MaxTextLength = 5000;

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("ole32.dll")] private static extern int CoInitializeEx(IntPtr reserved, uint mode);
    [DllImport("ole32.dll")] private static extern void CoUninitialize();

    private static VocaNativeSelectionResult Result(string status, string stage, int count, string text)
    {
        return new VocaNativeSelectionResult { status = status, stage = stage, candidateCount = count, text = text ?? "" };
    }

    private static void Check(int hresult)
    {
        if (hresult < 0) Marshal.ThrowExceptionForHR(hresult);
    }

    private sealed class ComScope : IDisposable
    {
        private readonly List<object> objects = new List<object>();
        public T Hold<T>(T value) where T : class
        {
            if (value == null) return null;
            foreach (object item in objects) if (Object.ReferenceEquals(item, value)) return value;
            objects.Add(value);
            return value;
        }
        public void Dispose()
        {
            for (int index = objects.Count - 1; index >= 0; index--)
            {
                try { if (Marshal.IsComObject(objects[index])) Marshal.FinalReleaseComObject(objects[index]); }
                catch { }
            }
        }
    }

    private sealed class Ancestors
    {
        public string Status = "outside-window";
        public readonly List<VocaUiaElement> Elements = new List<VocaUiaElement>();
    }

    private static bool Same(VocaUia automation, VocaUiaElement first, VocaUiaElement second)
    {
        if (first == null || second == null) return first == null && second == null;
        bool same;
        Check(automation.CompareElements(first, second, out same));
        return same;
    }

    private static Ancestors GetAncestors(VocaUia automation, VocaUiaWalker walker,
        VocaUiaElement element, VocaUiaElement foreground, ComScope scope)
    {
        Ancestors result = new Ancestors();
        for (int depth = 0; element != null && depth < 64; depth++)
        {
            try
            {
                object password;
                Check(element.GetCurrentPropertyValue(IsPasswordPropertyId, out password));
                if (password is bool && (bool)password) { result.Status = "protected"; return result; }
                result.Elements.Add(element);
                if (Same(automation, element, foreground)) { result.Status = "ok"; return result; }
                VocaUiaElement parent;
                Check(walker.GetParentElement(element, out parent));
                element = scope.Hold(parent);
            }
            catch { result.Status = "error"; return result; }
        }
        return result;
    }

    private static void AppendUnique(VocaUia automation, List<VocaUiaElement> target, Ancestors source)
    {
        if (source == null || source.Status != "ok") return;
        foreach (VocaUiaElement candidate in source.Elements)
        {
            bool duplicate = false;
            foreach (VocaUiaElement existing in target)
            {
                try { if (Same(automation, candidate, existing)) { duplicate = true; break; } }
                catch { }
            }
            if (!duplicate) target.Add(candidate);
        }
    }

    public static VocaNativeSelectionResult Read(bool usePoint, int x, int y, bool useOrigin, int originX, int originY)
    {
        string stage = "initialization";
        int count = 0;
        bool initialized = false;
        try
        {
            // This helper is a separate process. Both UIA and the mouse hook use
            // physical screen coordinates, including monitors with scaling.
            SetProcessDPIAware();
            int init = CoInitializeEx(IntPtr.Zero, 0); // COINIT_MULTITHREADED
            Check(init);
            initialized = true;
            using (ComScope scope = new ComScope())
            {
                IntPtr foreground = GetForegroundWindow();
                if (foreground == IntPtr.Zero) return Result("no-foreground", "foreground", 0, "");
                VocaUia automation = scope.Hold((VocaUia)Activator.CreateInstance(Type.GetTypeFromCLSID(
                    new Guid("FF48DBA4-60EF-4201-AA87-54103EEF594E"))));
                stage = "foreground";
                VocaUiaElement foregroundElement;
                Check(automation.ElementFromHandle(foreground, out foregroundElement));
                scope.Hold(foregroundElement);
                if (foregroundElement == null) return Result("unsupported", stage, 0, "");
                VocaUiaElement focused;
                Check(automation.GetFocusedElement(out focused));
                scope.Hold(focused);
                VocaUiaWalker walker;
                Check(automation.GetRawViewWalker(out walker));
                scope.Hold(walker);
                Ancestors focus = GetAncestors(automation, walker, focused, foregroundElement, scope);
                if (focus.Status == "protected") return Result("protected", "focus", 0, "");

                stage = "candidates";
                List<VocaUiaElement> candidates = new List<VocaUiaElement>();
                if (usePoint)
                {
                    Ancestors pointed = null;
                    try
                    {
                        VocaUiaElement element;
                        Check(automation.ElementFromPoint(new VocaUiaPoint { X = x, Y = y }, out element));
                        pointed = GetAncestors(automation, walker, scope.Hold(element), foregroundElement, scope);
                    }
                    catch { }
                    if (pointed != null && pointed.Status == "protected") return Result("protected", "point", 0, "");
                    AppendUnique(automation, candidates, pointed);
                }
                AppendUnique(automation, candidates, focus);
                count = candidates.Count;
                if (count == 0) return Result("unsupported", stage, 0, "");

                string selected = "";
                bool geometryRejected = false;
                bool oversized = false;
                int completed = 0;
                int errors = 0;
                stage = "selection";
                foreach (VocaUiaElement element in candidates)
                {
                    try
                    {
                        object rawPattern;
                        // Missing patterns are expected for ancestors/containers.
                        if (element.GetCurrentPattern(TextPatternId, out rawPattern) < 0 || rawPattern == null) continue;
                        scope.Hold(rawPattern);
                        VocaUiaTextPattern pattern = rawPattern as VocaUiaTextPattern;
                        if (pattern == null) continue;
                        int supported;
                        Check(pattern.GetSupportedTextSelection(out supported));
                        if (supported == 0) continue;
                        VocaUiaTextRangeArray ranges;
                        Check(pattern.GetSelection(out ranges));
                        scope.Hold(ranges);
                        if (ranges == null) { completed++; continue; }
                        int length;
                        Check(ranges.GetLength(out length));
                        if (length < 0 || length > 128) { oversized = true; continue; }
                        List<string> parts = new List<string>();
                        int total = 0;
                        bool matches = !usePoint;
                        bool tooLong = false;
                        for (int index = 0; index < length; index++)
                        {
                            VocaUiaTextRange range;
                            Check(ranges.GetElement(index, out range));
                            scope.Hold(range);
                            if (range == null) continue;
                            int separator = parts.Count > 0 ? 1 : 0;
                            int remaining = MaxTextLength - total - separator;
                            string part;
                            Check(range.GetText(Math.Max(1, remaining + 1), out part));
                            if (String.IsNullOrEmpty(part)) continue;
                            if (part.Length > remaining) { tooLong = true; break; }
                            if (usePoint)
                            {
                                double[] rectangles;
                                Check(range.GetBoundingRectangles(out rectangles));
                                if (TestSelectionGeometry(rectangles, x, y, useOrigin, originX, originY)) matches = true;
                            }
                            parts.Add(part);
                            total += part.Length + separator;
                        }
                        completed++;
                        if (tooLong) { oversized = true; continue; }
                        string text = String.Join("\n", parts.ToArray()).Trim();
                        if (text.Length == 0) continue;
                        if (!matches) { geometryRejected = true; continue; }
                        selected = text;
                        break;
                    }
                    catch { errors++; }
                }

                stage = "context";
                if (GetForegroundWindow() != foreground) return Result("focus-changed", "foreground", count, "");
                VocaUiaElement currentFocus;
                Check(automation.GetFocusedElement(out currentFocus));
                scope.Hold(currentFocus);
                if (!Same(automation, focused, currentFocus)) return Result("focus-changed", "focus", count, "");
                if (selected.Length > 0) return Result("selected", "selection", count, selected);
                if (geometryRejected) return Result("empty", "geometry", count, "");
                if (oversized) return Result("unsupported", "length", count, "");
                if (completed > 0) return Result("empty", "selection", count, "");
                if (errors > 0) return Result("error", "provider", count, "");
                return Result("unsupported", "text-pattern", count, "");
            }
        }
        catch { return Result("error", stage, count, ""); }
        finally { if (initialized) CoUninitialize(); }
    }

    public static bool TestSelectionGeometry(double[] rectangles, double endX, double endY,
        bool hasOrigin, double startX, double startY)
    {
        if (rectangles == null || rectangles.Length == 0 || rectangles.Length % 4 != 0) return false;
        if (!hasOrigin) { startX = endX; startY = endY; }
        const double tolerance = 12;
        for (int index = 0; index < rectangles.Length; index += 4)
        {
            double left = rectangles[index], top = rectangles[index + 1];
            double width = rectangles[index + 2], height = rectangles[index + 3];
            if (Double.IsNaN(left) || Double.IsInfinity(left) || Double.IsNaN(top) || Double.IsInfinity(top)
                || Double.IsNaN(width) || Double.IsInfinity(width) || Double.IsNaN(height) || Double.IsInfinity(height)
                || width <= 0 || height <= 0) continue;
            double low = 0, high = 1, dx = endX - startX, dy = endY - startY;
            double[] p = { -dx, dx, -dy, dy };
            double[] q = { startX - left + tolerance, left + width + tolerance - startX,
                startY - top + tolerance, top + height + tolerance - startY };
            bool intersects = true;
            for (int edge = 0; edge < 4; edge++)
            {
                if (p[edge] == 0) { if (q[edge] < 0) { intersects = false; break; } }
                else
                {
                    double ratio = q[edge] / p[edge];
                    if (p[edge] < 0) low = Math.Max(low, ratio); else high = Math.Min(high, ratio);
                    if (low > high) { intersects = false; break; }
                }
            }
            if (intersects) return true;
        }
        return false;
    }
}

[StructLayout(LayoutKind.Sequential)]
internal struct VocaUiaPoint { public int X; public int Y; }

// These interfaces intentionally stop after their last used method. Every
// preceding SDK slot is present; all HRESULTs are preserved and checked. Never
// reorder/remove an unused prefix method: doing so changes the native vtable.
[ComImport, Guid("30CBE57D-D9D0-452A-AB13-7AC5AC4825EE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface VocaUia
{
    [PreserveSig] int CompareElements(VocaUiaElement first, VocaUiaElement second, [MarshalAs(UnmanagedType.Bool)] out bool same);
    [PreserveSig] int CompareRuntimeIds(IntPtr first, IntPtr second, out int same);
    [PreserveSig] int GetRootElement(out VocaUiaElement element);
    [PreserveSig] int ElementFromHandle(IntPtr hwnd, out VocaUiaElement element);
    [PreserveSig] int ElementFromPoint(VocaUiaPoint point, out VocaUiaElement element);
    [PreserveSig] int GetFocusedElement(out VocaUiaElement element);
    [PreserveSig] int GetRootElementBuildCache(IntPtr cache, out VocaUiaElement element);
    [PreserveSig] int ElementFromHandleBuildCache(IntPtr hwnd, IntPtr cache, out VocaUiaElement element);
    [PreserveSig] int ElementFromPointBuildCache(VocaUiaPoint point, IntPtr cache, out VocaUiaElement element);
    [PreserveSig] int GetFocusedElementBuildCache(IntPtr cache, out VocaUiaElement element);
    [PreserveSig] int CreateTreeWalker(IntPtr condition, out VocaUiaWalker walker);
    [PreserveSig] int GetControlViewWalker(out VocaUiaWalker walker);
    [PreserveSig] int GetContentViewWalker(out VocaUiaWalker walker);
    [PreserveSig] int GetRawViewWalker(out VocaUiaWalker walker);
}

[ComImport, Guid("D22108AA-8AC5-49A5-837B-37BBB3D7591E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface VocaUiaElement
{
    [PreserveSig] int SetFocus();
    [PreserveSig] int GetRuntimeId(out IntPtr runtimeId);
    [PreserveSig] int FindFirst(int scope, IntPtr condition, out VocaUiaElement found);
    [PreserveSig] int FindAll(int scope, IntPtr condition, out IntPtr found);
    [PreserveSig] int FindFirstBuildCache(int scope, IntPtr condition, IntPtr cache, out VocaUiaElement found);
    [PreserveSig] int FindAllBuildCache(int scope, IntPtr condition, IntPtr cache, out IntPtr found);
    [PreserveSig] int BuildUpdatedCache(IntPtr cache, out VocaUiaElement element);
    [PreserveSig] int GetCurrentPropertyValue(int id, [MarshalAs(UnmanagedType.Struct)] out object value);
    [PreserveSig] int GetCurrentPropertyValueEx(int id, [MarshalAs(UnmanagedType.Bool)] bool ignoreDefault, [MarshalAs(UnmanagedType.Struct)] out object value);
    [PreserveSig] int GetCachedPropertyValue(int id, [MarshalAs(UnmanagedType.Struct)] out object value);
    [PreserveSig] int GetCachedPropertyValueEx(int id, [MarshalAs(UnmanagedType.Bool)] bool ignoreDefault, [MarshalAs(UnmanagedType.Struct)] out object value);
    [PreserveSig] int GetCurrentPatternAs(int id, ref Guid iid, out IntPtr pattern);
    [PreserveSig] int GetCachedPatternAs(int id, ref Guid iid, out IntPtr pattern);
    [PreserveSig] int GetCurrentPattern(int id, [MarshalAs(UnmanagedType.IUnknown)] out object pattern);
}

[ComImport, Guid("4042C624-389C-4AFC-A630-9DF854A541FC"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface VocaUiaWalker
{
    [PreserveSig] int GetParentElement(VocaUiaElement element, out VocaUiaElement parent);
}

[ComImport, Guid("32EBA289-3583-42C9-9C59-3B6D9A1E9B6A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface VocaUiaTextPattern
{
    [PreserveSig] int RangeFromPoint(VocaUiaPoint point, out VocaUiaTextRange range);
    [PreserveSig] int RangeFromChild(VocaUiaElement child, out VocaUiaTextRange range);
    [PreserveSig] int GetSelection(out VocaUiaTextRangeArray ranges);
    [PreserveSig] int GetVisibleRanges(out VocaUiaTextRangeArray ranges);
    [PreserveSig] int GetDocumentRange(out VocaUiaTextRange range);
    [PreserveSig] int GetSupportedTextSelection(out int selection);
}

[ComImport, Guid("CE4AE76A-E717-4C98-81EA-47371D028EB6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface VocaUiaTextRangeArray
{
    [PreserveSig] int GetLength(out int length);
    [PreserveSig] int GetElement(int index, out VocaUiaTextRange range);
}

[ComImport, Guid("A543CC6A-F4AE-494B-8239-C814481187A8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface VocaUiaTextRange
{
    [PreserveSig] int Clone(out VocaUiaTextRange range);
    [PreserveSig] int Compare(VocaUiaTextRange range, [MarshalAs(UnmanagedType.Bool)] out bool same);
    [PreserveSig] int CompareEndpoints(int source, VocaUiaTextRange range, int target, out int comparison);
    [PreserveSig] int ExpandToEnclosingUnit(int unit);
    [PreserveSig] int FindAttribute(int attribute, [MarshalAs(UnmanagedType.Struct)] object value, [MarshalAs(UnmanagedType.Bool)] bool backward, out VocaUiaTextRange found);
    [PreserveSig] int FindText([MarshalAs(UnmanagedType.BStr)] string text, [MarshalAs(UnmanagedType.Bool)] bool backward, [MarshalAs(UnmanagedType.Bool)] bool ignoreCase, out VocaUiaTextRange found);
    [PreserveSig] int GetAttributeValue(int attribute, [MarshalAs(UnmanagedType.Struct)] out object value);
    [PreserveSig] int GetBoundingRectangles([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_R8)] out double[] rectangles);
    [PreserveSig] int GetEnclosingElement(out VocaUiaElement element);
    [PreserveSig] int GetText(int maxLength, [MarshalAs(UnmanagedType.BStr)] out string text);
}
