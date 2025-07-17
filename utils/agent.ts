// @ts-nocheck
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { type Sandbox } from "@vercel/sandbox";
import {
  createSandbox,
  editFile,
  listFiles,
  readFile,
} from "./sandbox";

import util from 'node:util';
import child_process from 'node:child_process';
import fs from 'node:fs/promises';

import { experimental_createMCPClient as createMCPClient } from 'ai';

const createCodingAgentTools = (sandbox: Sandbox | undefined, setSandbox: (s: Sandbox) => void, repoUrl: string) => ({
  checkly_whoami: tool({
    description:
    "Figure out which accountid and accountname you are logged in with in Checkly. The response might contain unneeded details, be sure to extract only accountid and name.",
    inputSchema: z.object({}),
    execute: async ()=> {
      const exec = util.promisify(child_process.exec);

      const { stdout, stderr } = await exec("npx checkly whoami");
      return stdout
    }
  }),
  read_file: tool({
    description:
      "Read the contents of a given relative file path. Use this when you want to see what's inside a file. Do not use this with directory names.",
    inputSchema: z.object({
      path: z
        .string()
        .describe("The relative path of a file in the working directory."),
    }),
    execute: async ({ path }) => {
      try {
        if (!sandbox) {
          sandbox = await createSandbox(repoUrl);
          setSandbox(sandbox);
        }
        const output = await readFile(sandbox, path);
        return { path, output };
      } catch (error) {
        console.error(`Error reading file at ${path}:`, error.message);
        return { path, error: error.message };
      }
    },
  }),
  list_files: tool({
    description:
      "List files and directories at a given path. If no path is provided, lists files in the current directory.",
    inputSchema: z.object({
      path: z
        .string()
        .nullable()
        .describe(
          "Optional relative path to list files from. Defaults to current directory if not provided.",
        ),
    }),
    execute: async ({ path }) => {
      if (path === ".git" || path === "node_modules") {
        return { error: "You cannot read the path: ", path };
      }
      try {
        if (!sandbox) {
          sandbox = await createSandbox(repoUrl);
          setSandbox(sandbox);
        }
        const output = await listFiles(sandbox, path);
        return { path, output };
      } catch (e) {
        console.error(`Error listing files:`, e);
        return { error: e };
      }
    },
  }),
  edit_file: tool({
    description:
      "Make edits to a text file. Replaces 'old_str' with 'new_str' in the given file. 'old_str' and 'new_str' MUST be different from each other. If the file specified with path doesn't exist, it will be created.",
    inputSchema: z.object({
      path: z.string().describe("The path to the file"),
      old_str: z
        .string()
        .describe(
          "Text to search for - must match exactly and must only have one match exactly",
        ),
      new_str: z.string().describe("Text to replace old_str with"),
    }),
    execute: async ({ path, old_str, new_str }) => {
      try {
        if (!sandbox) {
          sandbox = await createSandbox(repoUrl);
          setSandbox(sandbox);
        }
        await editFile(sandbox, path, old_str, new_str);
        return { success: true };
      } catch (e) {
        console.error(`Error editing file ${path}:`, e);
        return { error: e };
      }
    },
  }),
  create_file: tool({
    description:
      "Create a new file with the specified content. If the file already exists, it will be overwritten.",
    inputSchema: z.object({
      path: z.string().describe("The path to the file to create"),
      content: z.string().describe("The content to write to the file"),
    }),
    execute: async ({ path, content }) => {
      try {
        await fs.writeFile(path, content, 'utf8');
        return { success: true, path };
      } catch (e) {
        console.error(`Error creating file ${path}:`, e);
        return { error: e };
      }
    },
  }),
});

export async function codingAgent(prompt: string, repoUrl?: string) {
  console.log("repoUrl:", repoUrl);
  let sandbox: Sandbox | undefined;

const mcpClient = await createMCPClient({
  transport: {
    type: 'sse',
    url: 'http://localhost:8931/sse',
  },
});
const playWrightTools = mcpClient.tools();

  const setSandbox = (s: Sandbox) => { sandbox = s; };
  const codingTools = createCodingAgentTools(sandbox, setSandbox, repoUrl!);
  const playwrightToolsResolved = await playWrightTools;
  const allTools = { ...codingTools, ...playwrightToolsResolved };

  const result = await generateText({
    model: "openai/gpt-4.1",
    prompt,
    system:
      "You are a coding agent. You will be working with js/ts projects. Your responses must be concise.",
    stopWhen: stepCountIs(10),
    onStepFinish: (step) => {
      console.log("Step finished:");
    },
    tools: allTools,

  });

  if (sandbox) {
    await sandbox.stop();
  }

  return { response: result.text };
}
