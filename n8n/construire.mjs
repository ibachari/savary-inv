import fs from "node:fs";
const jsCode = fs.readFileSync("code.js", "utf8");

const wf = {
  name: "Inventaire emballages — annonce Slack",
  nodes: [
    {
      parameters: { httpMethod: "POST", path: "inventaire-emballage-4c81f2ae", responseMode: "lastNode", responseData: "firstEntryJson", options: {} },
      id: "a1000000-0000-4000-8000-000000000001",
      name: "Inventaire envoyé",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [-240, 0],
      webhookId: "4c81f2ae-1b6d-4f7a-9c21-6d0e5a3b7e10",
    },
    {
      parameters: { mode: "runOnceForAllItems", jsCode },
      id: "a1000000-0000-4000-8000-000000000002",
      name: "Résumer le comptage",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [-20, 0],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
          conditions: [{ id: "c1", leftValue: "={{ $json.poster }}", rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }],
          combinator: "and",
        },
        options: {},
      },
      id: "a1000000-0000-4000-8000-000000000003",
      name: "Clôture volontaire ?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.2,
      position: [200, 0],
    },
    {
      parameters: {
        method: "POST",
        url: "https://slack.com/api/chat.postMessage",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendBody: true,
        specifyBody: "json",
        jsonBody: '={{ JSON.stringify({ channel: $json.channel, text: $json.texte, username: "Inventaire emballages", icon_emoji: ":package:", unfurl_links: false }) }}',
        options: {},
      },
      id: "a1000000-0000-4000-8000-000000000004",
      name: "Annoncer dans #prod-emballage",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [420, -100],
      credentials: { httpHeaderAuth: { id: "Y363bYdntvl2Y5Fd", name: "Slack Savary Bot" } },
    },
    {
      parameters: {},
      id: "a1000000-0000-4000-8000-000000000005",
      name: "Rien à annoncer",
      type: "n8n-nodes-base.noOp",
      typeVersion: 1,
      position: [420, 100],
    },
  ],
  connections: {
    "Inventaire envoyé": { main: [[{ node: "Résumer le comptage", type: "main", index: 0 }]] },
    "Résumer le comptage": { main: [[{ node: "Clôture volontaire ?", type: "main", index: 0 }]] },
    "Clôture volontaire ?": {
      main: [
        [{ node: "Annoncer dans #prod-emballage", type: "main", index: 0 }],
        [{ node: "Rien à annoncer", type: "main", index: 0 }],
      ],
    },
  },
  settings: { executionOrder: "v1", timezone: "Europe/Paris", callerPolicy: "workflowsFromSameOwner" },
};

fs.writeFileSync("inventaire-slack.json", JSON.stringify(wf, null, 2) + "\n");
console.log("écrit :", wf.nodes.length, "nœuds");
