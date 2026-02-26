// Zero-dependency interactive prompts using readline

import * as readline from "node:readline";

function ask(question, defaultVal = "") {
  return new Promise(resolve => {
    const hint = defaultVal ? ` (${defaultVal})` : "";
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${question}${hint}: `, answer => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

export async function promptInit() {
  const policyId = await ask("Project / policy name", process.env._INFERNO_DEFAULT_POLICY || "my-project");
  const caps = await ask("Capabilities (comma-separated)", "CreateTask, ReadTasks, UpdateTask, DeleteTask");
  return { policyId, capabilities: caps.split(",").map(c => c.trim()).filter(Boolean) };
}
