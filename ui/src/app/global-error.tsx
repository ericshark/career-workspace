"use client";
import { useEffect } from "react";

// Last resort for an error in the root layout itself. It replaces the layout, so it needs its own
// document and cannot rely on the app's styles.
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          maxWidth: 560,
          margin: "4rem auto",
          padding: "0 1rem",
          textAlign: "center",
        }}
      >
        <h1>Career hit a problem</h1>
        <p>Your data is not affected.</p>
        <button
          onClick={() => retry()}
          style={{ padding: "0.5rem 1rem", fontSize: "1rem" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
