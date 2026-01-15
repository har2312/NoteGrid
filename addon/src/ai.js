export async function analyzeText(text, files = []) {
  const formData = new FormData();
  formData.append("text", text || "");
  (files || []).forEach((file) => formData.append("files", file));

  const res = await fetch("http://localhost:3001/analyze", {
    method: "POST",
    body: formData
  });

  if (!res.ok) {
    throw new Error("Backend failed");
  }

  const data = await res.json();

  // 🔴 IMPORTANT: return data AS-IS
  return data;
}
