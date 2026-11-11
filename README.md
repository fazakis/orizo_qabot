# Orizo trainer FAQ bot

A small, self-contained encrypted bot. Edit `answers.mjs` to change its answers.
The communication/encryption runtime, binaries, corresponding source and license
notices are included in `lib/`.

## Run on Linux

1. Install Node **24.22.2 or newer**.
2. In Orizo **Settings → Bots**, create a self-hosted bot and save its token in
   a private text file (outside this repository). Do not paste the token into
   a shell command, commit it, or share it in chat.
3. Clone and run:

```sh
git clone https://github.com/fazakis/orizo_qabot.git
cd orizo_qabot
chmod 600 ~/qatestbottoken
node bot.mjs --token-file ~/qatestbottoken --state-dir ~/.local/share/orizo-qabot
```

**No `npm install` or compilation is needed to run it.**
For LOCALDEV testing use a **LOCALDEV-issued token** and add `--environment localdev`.
This selects `https://dev.orizo.app` for API/media and a separate default state folder
`~/.local/share/orizo-qabot-localdev`. Production remains the default. Arbitrary
API origins are not accepted; never reuse production state for LOCALDEV.
Open the bot in Orizo, press **Start**, then send `/help` or “How should I warm up?”.
In a consented group, mention `@your_bot_username` in your question.
Only conversations granted access by Orizo can be read; bot messages, deleted/
expired/view-once messages and encrypted control events do not trigger replies.
The examples are English, text-only FAQs, not individualized medical advice.

For a private test, append `--allow-user 123 --conversation CONVERSATION_UUID`.
Repeat these options to add entries. Without these optional limits, the bot
answers users who explicitly start it and mentions in admin-consented groups.

## Restart and keys

Stop with Ctrl+C. Start the **same command with the same state folder** again.
Keys are generated on first use and reused. Checkpoints and encrypted send
records prevent duplicate replies after a normal restart or a retried send.
One copy can use a state folder at a time; the server also enforces one writer.
After a crash, the old server lease may take up to two minutes to expire.

The state directory must be owned by you and mode `0700`; private files are
`0600`. It contains **unencrypted bot key records** under `keys/`, and message
checkpoints/ciphertext under `messages/`. These are protected by filesystem
permissions, not a master key. Anyone who controls your machine/account or reads
that folder can read this bot's messages. Orizo's server does not receive the
bot's private keys. Protect backups and use encrypted disks where appropriate.

Never delete the state folder to fix a login problem. A different token cannot
silently take over an existing identity. For an existing Keychain/vault bot,
migrate its complete account/device/recovery records and message state while
its old process is stopped; **copying just its token is not an identity migration**.
New installations do not need a migration/provisioning command.

## Test the bundled code

```sh
npm test
npm run test:integration
npm run test:transport
```

Tests use synthetic identities and do not need production credentials.
Verification coverage and limits are in [VERIFICATION.md](VERIFICATION.md).
The bundled runtime provenance and rebuild instructions are in [Messaging library README](lib/README.md).

## License

AGPL-3.0-only for the example and Orizo runtime; included third-party components
retain their licenses. See [LICENSE](LICENSE), [Messaging NOTICE](lib/NOTICE) and
`lib/licenses/`. Complete corresponding crypto sources are in `lib/source/`.


## Standalone maintenance

Messaging code is ordinary local source in `lib/`, not a separately versioned
SDK dependency. No sibling repositories or snapshot update tool are needed.
Run `npm run verify:standalone` and `npm run test:runtime` as well as the tests
above when changing it. Preserve crypto provenance and licenses. Port fixes
explicitly to other bot applications when relevant.
