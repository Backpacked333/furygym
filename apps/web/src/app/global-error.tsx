"use client";

// Replaces the whole document when the root layout itself fails, so it carries its own styles.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", background: "#000", color: "#fff", fontFamily: "-apple-system, system-ui, Helvetica, Arial, sans-serif" }}>
        <main style={{ maxWidth: 448, margin: "0 auto", padding: "96px 24px" }}>
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>Fury Co. Athletics could not load</h1>
          <p style={{ marginTop: 12, color: "rgba(235,235,245,0.7)" }}>Nothing was saved or changed. Check the connection and try again.</p>
          <button
            onClick={() => retry()}
            style={{ marginTop: 24, padding: "10px 18px", borderRadius: 10, border: 0, background: "#e9152d", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
