# Sanu Code

Sanu Code is this fork run from source beside an installed T3 Code. It keeps its own data in
`~/.sanucode`, so the installed app, its database, and its connections stay untouched.

## Set up

Install `vp` ([Install vp](../../README.md#install-vp)), clone the fork, and run in the checkout:

```sh
vp i
./scripts/sanucode install
```

This links `sanucode` and its alias `sn` in `~/.local/bin` to that checkout, so `git pull` also
updates the command. `sn help` lists every command. Sanu Code runs on the Node version pinned in
`package.json`, even when a Node version manager such as nvm selects another one.

| Command  | Opens                                                                                    |
| -------- | ---------------------------------------------------------------------------------------- |
| `sn app` | The desktop app                                                                          |
| `sn`     | The web app at `http://localhost:5733`. Open the `pairingUrl` it prints once per browser |

Both use the same data and ports, so run one at a time. Sanu Code runs only while that command
does; keep its terminal open while you need it, including from your phone.

## Move over from T3 Code

`sn import` replaces Sanu Code's data with a copy of the installed T3 Code's projects, threads,
settings, keybindings, and display preferences. It saves the previous Sanu Code data in
`~/.sanucode/backup` and refuses to run while Sanu Code is open.

1. Let running threads in T3 Code finish.
2. Quit and reopen T3 Code once. It closes inactive agent sessions on start, and the import skips
   any thread whose session is still open.
3. Quit Sanu Code, then run `sn import`. It prints the threads each project received. Skipped
   threads stay readable in T3 Code.

Treat the import as a one-time move: running it again later replaces everything you did in Sanu
Code. It does not bring sign-ins, paired phones and machines, scheduled tasks, or secrets.
Reconnect devices as described below.

## Connect your phone

Sanu Code has no T3 Connect, because official builds carry the relay configuration and a build
from source does not. Phones and other machines reach it over your local network or Tailscale.

1. Start `sn app`, open **Settings → Sharing & access**, and turn on **Network access**. The app
   restarts.
2. Create a pairing link with an address your phone can reach, such as your computer's Tailscale
   address.
3. In the mobile app, open **Settings → Environments → Add environment** and scan the QR code.

Pair from `sn app`, which lists your computer's network addresses. The paired phone also reaches
`sn`, whose server listens on every interface at the same port. Plain HTTP works over Tailscale.
For HTTPS, enable HTTPS certificates for your tailnet, then use `sn --share --built`.

## Connect other machines

For each machine running T3 Code that you want to control from Sanu Code:

1. Let it accept network connections: run `t3 up --lan` on a command-line host, or turn on
   **Network access** in its desktop app.
2. Run `t3 pair` on that machine.
3. In Sanu Code, open **Settings → Environments → Add environment** and paste the link. If its
   address is not reachable from your computer, replace the host with the machine's Tailscale
   name or address and keep the port.

This adds a new sign-in on that machine, and T3 Code's existing connection keeps working. Features
unique to this fork only work on machines that run Sanu Code.

## Day to day

- Update with `git pull` in the checkout, then restart Sanu Code.
- Keep T3 Code installed as a fallback, but never run agents in the same worktree from both apps.
- Once you stop using T3 Code, remove its environment from your phone and other clients.
