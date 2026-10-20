// Fast pixel operations for tools/hero-assets.ps1.
// Loaded with Add-Type, so it must compile as C# 5 (.NET Framework / Windows PowerShell 5.1):
// no string interpolation, no expression-bodied members, no tuples.
// Pixels are int[] ARGB (0xAARRGGBB), row-major.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class HeroImg
{
    // ---------- I/O ----------

    public static int[] Read(Bitmap src)
    {
        int w = src.Width, h = src.Height;
        Bitmap b = src;
        bool tmp = false;
        if (src.PixelFormat != PixelFormat.Format32bppArgb)
        {
            b = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(b)) { g.DrawImage(src, 0, 0, w, h); }
            tmp = true;
        }
        BitmapData d = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int[] px = new int[w * h];
        for (int y = 0; y < h; y++)
            Marshal.Copy(IntPtr.Add(d.Scan0, y * d.Stride), px, y * w, w);
        b.UnlockBits(d);
        if (tmp) b.Dispose();
        return px;
    }

    public static Bitmap Write(int[] px, int w, int h)
    {
        Bitmap b = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        BitmapData d = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        for (int y = 0; y < h; y++)
            Marshal.Copy(px, y * w, IntPtr.Add(d.Scan0, y * d.Stride), w);
        b.UnlockBits(d);
        return b;
    }

    // ---------- colour helpers ----------

    public static int A(int c) { return (c >> 24) & 255; }
    public static int R(int c) { return (c >> 16) & 255; }
    public static int G(int c) { return (c >> 8) & 255; }
    public static int B(int c) { return c & 255; }
    public static int Argb(int a, int r, int g, int b) { return (a << 24) | (r << 16) | (g << 8) | b; }
    static int Clamp(int v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }

    public static int Dist2(int c1, int c2)
    {
        int dr = R(c1) - R(c2), dg = G(c1) - G(c2), db = B(c1) - B(c2);
        return dr * dr + dg * dg + db * db;
    }

    // ---------- geometry ----------

    public static int[] Crop(int[] px, int w, int h, int x0, int y0, int cw, int ch)
    {
        int[] o = new int[cw * ch];
        for (int y = 0; y < ch; y++)
        {
            int sy = y0 + y;
            if (sy < 0 || sy >= h) continue;
            for (int x = 0; x < cw; x++)
            {
                int sx = x0 + x;
                if (sx < 0 || sx >= w) continue;
                o[y * cw + x] = px[sy * w + sx];
            }
        }
        return o;
    }

    // Paste src onto dst at (x0,y0); opaque src pixels (alpha >= 128) replace dst.
    public static void Blit(int[] dst, int dw, int dh, int[] src, int sw, int sh, int x0, int y0)
    {
        for (int y = 0; y < sh; y++)
        {
            int dy = y0 + y;
            if (dy < 0 || dy >= dh) continue;
            for (int x = 0; x < sw; x++)
            {
                int dx = x0 + x;
                if (dx < 0 || dx >= dw) continue;
                int c = src[y * sw + x];
                if (A(c) >= 128) dst[dy * dw + dx] = c;
            }
        }
    }

    // Integer box downscale: w and h must be multiples of s. Alpha-weighted colour average.
    public static int[] BoxDown(int[] px, int w, int h, int s)
    {
        int nw = w / s, nh = h / s;
        int[] o = new int[nw * nh];
        for (int y = 0; y < nh; y++)
            for (int x = 0; x < nw; x++)
            {
                long sa = 0, sr = 0, sg = 0, sb = 0;
                for (int yy = 0; yy < s; yy++)
                    for (int xx = 0; xx < s; xx++)
                    {
                        int c = px[(y * s + yy) * w + x * s + xx];
                        int a = A(c);
                        sa += a; sr += R(c) * a; sg += G(c) * a; sb += B(c) * a;
                    }
                int n = s * s;
                if (sa == 0) { o[y * nw + x] = 0; continue; }
                o[y * nw + x] = Argb((int)(sa / n), (int)(sr / sa), (int)(sg / sa), (int)(sb / sa));
            }
        return o;
    }

    // Area-average resample to any smaller size (used for sprites). Alpha-weighted.
    public static int[] AreaResize(int[] px, int w, int h, int nw, int nh)
    {
        int[] o = new int[nw * nh];
        double fx = (double)w / nw, fy = (double)h / nh;
        for (int y = 0; y < nh; y++)
        {
            int y0 = (int)Math.Floor(y * fy), y1 = Math.Max(y0 + 1, (int)Math.Floor((y + 1) * fy));
            for (int x = 0; x < nw; x++)
            {
                int x0 = (int)Math.Floor(x * fx), x1 = Math.Max(x0 + 1, (int)Math.Floor((x + 1) * fx));
                long sa = 0, sr = 0, sg = 0, sb = 0; int n = 0;
                for (int yy = y0; yy < y1 && yy < h; yy++)
                    for (int xx = x0; xx < x1 && xx < w; xx++)
                    {
                        int c = px[yy * w + xx]; int a = A(c);
                        sa += a; sr += R(c) * a; sg += G(c) * a; sb += B(c) * a; n++;
                    }
                if (sa == 0 || n == 0) { o[y * nw + x] = 0; continue; }
                o[y * nw + x] = Argb((int)(sa / n), (int)(sr / sa), (int)(sg / sa), (int)(sb / sa));
            }
        }
        return o;
    }

    public static int[] UpNearest(int[] px, int w, int h, int s)
    {
        int nw = w * s;
        int[] o = new int[nw * h * s];
        for (int y = 0; y < h * s; y++)
            for (int x = 0; x < nw; x++)
                o[y * nw + x] = px[(y / s) * w + x / s];
        return o;
    }

    // ---------- alpha ----------

    // Pixel art has 1-bit alpha: fully on or fully off.
    public static void BinarizeAlpha(int[] px, int threshold)
    {
        for (int i = 0; i < px.Length; i++)
        {
            int c = px[i];
            px[i] = A(c) >= threshold ? (c | unchecked((int)0xFF000000)) : 0;
        }
    }

    // Make pixels close to a key colour transparent (for sprite sheets on a solid background).
    public static void KeyOut(int[] px, int key, int tol)
    {
        int t2 = tol * tol;
        for (int i = 0; i < px.Length; i++)
            if (A(px[i]) > 0 && Dist2(px[i], key) <= t2) px[i] = 0;
    }

    // Remove the coloured halo left by background removal: opaque pixels touching transparency
    // whose colour is far from the interior pixels next to them. Dark outline pixels are kept.
    public static int Defringe(int[] px, int w, int h, int passes, int tol)
    {
        int removed = 0, t2 = tol * tol;
        for (int p = 0; p < passes; p++)
        {
            bool[] edge = new bool[px.Length];
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int i = y * w + x;
                    if (A(px[i]) == 0) continue;
                    if (x == 0 || y == 0 || x == w - 1 || y == h - 1 ||
                        A(px[i - 1]) == 0 || A(px[i + 1]) == 0 || A(px[i - w]) == 0 || A(px[i + w]) == 0)
                        edge[i] = true;
                }
            List<int> kill = new List<int>();
            for (int y = 1; y < h - 1; y++)
                for (int x = 1; x < w - 1; x++)
                {
                    int i = y * w + x;
                    if (!edge[i]) continue;
                    int c = px[i];
                    int lum = (R(c) * 3 + G(c) * 6 + B(c)) / 10;
                    if (lum < 70) continue;                       // keep dark outlines
                    long sr = 0, sg = 0, sb = 0; int n = 0;
                    for (int dy = -2; dy <= 2; dy++)
                        for (int dx = -2; dx <= 2; dx++)
                        {
                            int xx = x + dx, yy = y + dy;
                            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                            int j = yy * w + xx;
                            if (A(px[j]) == 0 || edge[j]) continue;
                            sr += R(px[j]); sg += G(px[j]); sb += B(px[j]); n++;
                        }
                    bool isolated = n == 0;
                    if (isolated) { kill.Add(i); continue; }
                    int mean = Argb(255, (int)(sr / n), (int)(sg / n), (int)(sb / n));
                    int sat = Math.Max(R(c), Math.Max(G(c), B(c))) - Math.Min(R(c), Math.Min(G(c), B(c)));
                    if (Dist2(c, mean) > t2 && sat > 60) kill.Add(i);
                }
            foreach (int i in kill) px[i] = 0;
            removed += kill.Count;
            if (kill.Count == 0) break;
        }
        return removed;
    }

    // ---------- palette ----------

    // Deterministic k-means (k-means++ seeding) over opaque pixels.
    public static int[] KMeansPalette(int[] px, int k, int iters)
    {
        List<int> pts = new List<int>();
        for (int i = 0; i < px.Length; i++) if (A(px[i]) >= 128) pts.Add(px[i]);
        if (pts.Count == 0) return new int[0];
        Random rnd = new Random(42);
        // subsample for speed
        if (pts.Count > 60000)
        {
            List<int> s = new List<int>(60000);
            for (int i = 0; i < 60000; i++) s.Add(pts[rnd.Next(pts.Count)]);
            pts = s;
        }
        int n = pts.Count;
        double[][] cent = new double[k][];
        int first = pts[rnd.Next(n)];
        cent[0] = new double[] { R(first), G(first), B(first) };
        double[] d = new double[n];
        for (int c = 1; c < k; c++)
        {
            double sum = 0;
            for (int i = 0; i < n; i++)
            {
                double best = double.MaxValue;
                for (int j = 0; j < c; j++)
                {
                    double dr = R(pts[i]) - cent[j][0], dg = G(pts[i]) - cent[j][1], db = B(pts[i]) - cent[j][2];
                    double dd = dr * dr + dg * dg + db * db;
                    if (dd < best) best = dd;
                }
                d[i] = best; sum += best;
            }
            double r = rnd.NextDouble() * sum; int pick = n - 1;
            for (int i = 0; i < n; i++) { r -= d[i]; if (r <= 0) { pick = i; break; } }
            cent[c] = new double[] { R(pts[pick]), G(pts[pick]), B(pts[pick]) };
        }
        int[] assign = new int[n];
        for (int it = 0; it < iters; it++)
        {
            double[][] acc = new double[k][]; int[] cnt = new int[k];
            for (int j = 0; j < k; j++) acc[j] = new double[3];
            for (int i = 0; i < n; i++)
            {
                int best = 0; double bd = double.MaxValue;
                for (int j = 0; j < k; j++)
                {
                    double dr = R(pts[i]) - cent[j][0], dg = G(pts[i]) - cent[j][1], db = B(pts[i]) - cent[j][2];
                    double dd = dr * dr + dg * dg + db * db;
                    if (dd < bd) { bd = dd; best = j; }
                }
                assign[i] = best; cnt[best]++;
                acc[best][0] += R(pts[i]); acc[best][1] += G(pts[i]); acc[best][2] += B(pts[i]);
            }
            for (int j = 0; j < k; j++)
                if (cnt[j] > 0) cent[j] = new double[] { acc[j][0] / cnt[j], acc[j][1] / cnt[j], acc[j][2] / cnt[j] };
        }
        List<int> pal = new List<int>(k + 2);
        for (int j = 0; j < k; j++)
            pal.Add(Argb(255, Clamp((int)Math.Round(cent[j][0])), Clamp((int)Math.Round(cent[j][1])), Clamp((int)Math.Round(cent[j][2]))));
        // Small, bright or dark details (the sun, outlines) get averaged away by k-means: keep the extremes.
        int hi = pts[0], lo = pts[0];
        for (int i = 0; i < px.Length; i++)
        {
            int c = px[i]; if (A(c) < 128) continue;
            int l = R(c) * 3 + G(c) * 6 + B(c), lh = R(hi) * 3 + G(hi) * 6 + B(hi), ll = R(lo) * 3 + G(lo) * 6 + B(lo);
            if (l > lh) hi = c; if (l < ll) lo = c;
        }
        foreach (int extreme in new int[] { hi, lo })
        {
            int best = int.MaxValue;
            foreach (int p in pal) best = Math.Min(best, Dist2(p, extreme));
            if (best > 900) pal.Add(extreme | unchecked((int)0xFF000000));
        }
        return pal.ToArray();
    }

    public static void MapToPalette(int[] px, int[] pal)
    {
        Dictionary<int, int> cache = new Dictionary<int, int>();
        for (int i = 0; i < px.Length; i++)
        {
            int c = px[i];
            if (A(c) < 128) { px[i] = 0; continue; }
            int key = c & 0xFFFFFF, hit;
            if (!cache.TryGetValue(key, out hit))
            {
                int best = 0, bd = int.MaxValue;
                for (int j = 0; j < pal.Length; j++)
                {
                    int dd = Dist2(c, pal[j]);
                    if (dd < bd) { bd = dd; best = j; }
                }
                hit = pal[best] | unchecked((int)0xFF000000);
                cache[key] = hit;
            }
            px[i] = hit;
        }
    }

    // ---------- comparison / layers ----------

    // Blend `edit` over `baseImg` where mask alpha is 0 (the edit area). The edit fades in over
    // `feather` px INSIDE the edit area, so everything outside it is exactly `baseImg`.
    public static int[] Composite(int[] baseImg, int[] edit, int[] mask, int w, int h, int feather)
    {
        // dist = distance (chamfer 3/4, so /3 ~ px) from each edit pixel to the nearest kept pixel.
        int big = 1 << 20;
        int[] dist = new int[w * h];
        for (int i = 0; i < dist.Length; i++) dist[i] = A(mask[i]) < 128 ? big : 0;
        // two-pass chamfer distance (3/4 metric, /3 ~ px)
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                int i = y * w + x, v = dist[i];
                if (x > 0) v = Math.Min(v, dist[i - 1] + 3);
                if (y > 0) v = Math.Min(v, dist[i - w] + 3);
                if (x > 0 && y > 0) v = Math.Min(v, dist[i - w - 1] + 4);
                if (x < w - 1 && y > 0) v = Math.Min(v, dist[i - w + 1] + 4);
                dist[i] = v;
            }
        for (int y = h - 1; y >= 0; y--)
            for (int x = w - 1; x >= 0; x--)
            {
                int i = y * w + x, v = dist[i];
                if (x < w - 1) v = Math.Min(v, dist[i + 1] + 3);
                if (y < h - 1) v = Math.Min(v, dist[i + w] + 3);
                if (x < w - 1 && y < h - 1) v = Math.Min(v, dist[i + w + 1] + 4);
                if (x > 0 && y < h - 1) v = Math.Min(v, dist[i + w - 1] + 4);
                dist[i] = v;
            }
        int[] o = new int[w * h];
        for (int i = 0; i < o.Length; i++)
        {
            double d = dist[i] / 3.0;
            double t = feather <= 0 ? (d > 0 ? 1 : 0) : Math.Min(1, d / feather);
            if (t <= 0) { o[i] = baseImg[i]; continue; }
            if (t >= 1) { o[i] = edit[i]; continue; }
            int a = baseImg[i], b = edit[i];
            o[i] = Argb(255,
                (int)Math.Round(R(a) + (R(b) - R(a)) * t),
                (int)Math.Round(G(a) + (G(b) - G(a)) * t),
                (int)Math.Round(B(a) + (B(b) - B(a)) * t));
        }
        return o;
    }

    // Fraction of "keep" pixels (mask alpha >= 128) whose colour differs by more than tol.
    public static double CompareOutside(int[] a, int[] b, int[] mask, int tol)
    {
        long keep = 0, diff = 0; int t2 = tol * tol;
        for (int i = 0; i < a.Length; i++)
        {
            if (mask != null && A(mask[i]) < 128) continue;
            keep++;
            if (Dist2(a[i], b[i]) > t2) diff++;
        }
        return keep == 0 ? 0 : (double)diff / keep;
    }

    // Pixels of `withAdd` that differ from `plate` by more than tol, as an opaque layer.
    // Isolated specks are removed and small holes filled.
    public static int[] Diff(int[] withAdd, int[] plate, int w, int h, int tol)
    {
        int t2 = tol * tol;
        int[] o = new int[w * h];
        for (int i = 0; i < o.Length; i++)
            if (Dist2(withAdd[i], plate[i]) > t2) o[i] = withAdd[i] | unchecked((int)0xFF000000);
        int[] o2 = (int[])o.Clone();
        for (int y = 1; y < h - 1; y++)
            for (int x = 1; x < w - 1; x++)
            {
                int i = y * w + x, n = 0;
                for (int dy = -1; dy <= 1; dy++)
                    for (int dx = -1; dx <= 1; dx++)
                        if ((dx != 0 || dy != 0) && A(o[i + dy * w + dx]) > 0) n++;
                if (A(o[i]) > 0 && n < 2) o2[i] = 0;                       // speck
                else if (A(o[i]) == 0 && n >= 6) o2[i] = withAdd[i] | unchecked((int)0xFF000000); // hole
            }
        return o2;
    }

    // Bounding box of opaque pixels: {minX, minY, maxX, maxY}, or null when empty.
    public static int[] Bounds(int[] px, int w, int h)
    {
        int minX = w, minY = h, maxX = -1, maxY = -1;
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
                if (A(px[y * w + x]) >= 128)
                {
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
        return maxX < 0 ? null : new int[] { minX, minY, maxX, maxY };
    }

    // 8-connected opaque components: each {minX, minY, maxX, maxY, area, cx, cy}.
    public static List<int[]> Components(int[] px, int w, int h, int minArea)
    {
        List<int[]> res = new List<int[]>();
        bool[] seen = new bool[w * h];
        Stack<int> st = new Stack<int>();
        for (int s = 0; s < px.Length; s++)
        {
            if (seen[s] || A(px[s]) < 128) continue;
            int minX = w, minY = h, maxX = 0, maxY = 0, area = 0; long sx = 0, sy = 0;
            st.Push(s); seen[s] = true;
            while (st.Count > 0)
            {
                int i = st.Pop(), x = i % w, y = i / w;
                area++; sx += x; sy += y;
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
                for (int dy = -1; dy <= 1; dy++)
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        int xx = x + dx, yy = y + dy;
                        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                        int j = yy * w + xx;
                        if (!seen[j] && A(px[j]) >= 128) { seen[j] = true; st.Push(j); }
                    }
            }
            if (area >= minArea) res.Add(new int[] { minX, minY, maxX, maxY, area, (int)(sx / area), (int)(sy / area) });
        }
        return res;
    }

    // Mean x of opaque pixels in rows [y0, y1): a stable horizontal anchor (torso) for walk frames.
    public static double MeanX(int[] px, int w, int y0, int y1)
    {
        long sx = 0, n = 0;
        for (int y = y0; y < y1; y++)
            for (int x = 0; x < w; x++)
                if (A(px[y * w + x]) >= 128) { sx += x; n++; }
        return n == 0 ? w / 2.0 : (double)sx / n;
    }

    // Count of pixels with partial alpha (should be 0 for finished pixel art).
    public static int PartialAlpha(int[] px)
    {
        int n = 0;
        for (int i = 0; i < px.Length; i++) { int a = A(px[i]); if (a > 0 && a < 255) n++; }
        return n;
    }
}
