import { analyzeText } from "./ai.js";

const board = document.getElementById("board");
const btn = document.getElementById("analyzeBtn");
const input = document.getElementById("inputText");

btn.onclick = async () => {
  board.innerHTML = "Analyzing with AI…";

  try {
    const notes = await analyzeText(input.value);
    board.innerHTML = "";

    notes.forEach(n => {
      const div = document.createElement("div");
      div.className = `sticky ${n.type}`;
      div.innerText = n.text;
      board.appendChild(div);
    });
  } catch (e) {
    board.innerHTML = "AI failed. Is backend running?";
  }
};
