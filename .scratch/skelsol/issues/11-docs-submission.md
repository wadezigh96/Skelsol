# 11: Docs and submission

**What to build:** the documents that make the project submittable: a
README a judge can follow in minutes, a Devpost submission draft with
honest judge instructions, and a deploy record. The demo video link and
the "How Kiro was used" section stay honest TODO placeholders: the video
is recorded by the owner, and the Kiro write-up is the owner's real
experience. Neither is ever invented.

**Blocked by:** 06 (Ghost Mint), 09 (Market app), 10 (skel CLI).

**Status:** ready-for-agent

- [ ] README: what Skelsol is, the three consumers, architecture, quickstart, judge path, honest limits
- [ ] `docs/SUBMISSION.md`: Devpost draft with judge testing instructions (devnet faucet, mint, list, buy, cancel, CLI); video link and "How Kiro was used" as honest TODOs
- [ ] `docs/DEPLOY.md`: escrow program ID, explorer link, redeploy script, devnet reset notes
- [ ] Final verification: `npm test` green, typecheck green, both apps build, CLI runs `--help`
