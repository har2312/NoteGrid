export async function analyzeText(text) {
  const res = await fetch("http://localhost:3001/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ text })
  });

  if (!res.ok) {
    throw new Error("Backend failed");
  }

  const data = await res.json();

  // 🔴 IMPORTANT: return data AS-IS
  return data;
}
