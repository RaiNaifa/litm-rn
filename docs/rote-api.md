# Rote scripting API

The script receives `context` and `api` as arguments. Linked Macros receive the same objects through `event.roteContext` and `event.roteApi`.

| `context` field | Meaning |
| --- | --- |
| `mode` | `"roll"`, `"simple"`, or `"campNoRoll"` |
| `rollType` | `"quick"`, `"tracked"`, `"reaction"`, or `"simple"` |
| `outcome` | `"failure"`, `"consequence"`, `"success"`, or `null` if unavailable |
| `isCampAction` | Whether the action was a camp action |
| `totalPower` | Roll power, or `null` when it does not apply |
| `actorId`, `roteId`, `roteUuid`, `roteName` | Character and Rote identifiers and the Rote name |
| `initiatorId` | ID of the user who used the Rote |
| `sceneId`, `tokenId`, `targetIds` | Scene, token, and target token IDs captured when the action was used |
| `rollId`, `messageId` | Action and chat message IDs |

`api.getActor()`, `api.getRote()`, and `api.getMessage()` return the corresponding Foundry documents when available. `api.getRote()` can return `null` if the user does not have access to the Rote document. Use `context.roteName` when you only need its name.

Example Rote script:

```js
if (context.outcome === "success") {
  const actor = api.getActor();
  console.log(`${actor?.name ?? "A character"} used ${context.roteName}`);
}
```

Example linked Macro:

```js
const { roteContext, roteApi } = event;
console.log(roteContext.roteName, roteApi.getMessage());
```
