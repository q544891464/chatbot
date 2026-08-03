# OpenAPI Address-Book Sync

`openapi-address-book-latest.json` is the source used to enrich Chatbot users by phone number and to present department usage in Yuxi. Run the following command from the project root to refresh it once:

```bash
node scripts/sync-openapi-address-book.js
```

The script requests an application access token, recursively loads departments and their direct members, validates encrypted OpenAPI responses, writes the JSON atomically, then runs `scripts/import-address-book.js` to update MySQL. If a request, decrypt/signature check, or response-size threshold fails, the existing JSON remains untouched.

## Configuration

The script loads `server/.env` and then the untracked file `scripts/address-book-sync.env`. Copy `scripts/address-book-sync.env.example` to that path and set `ADDRESS_BOOK_OPENAPI_BASE_URL`. It uses `AUTH_CLIENT_ID` and `AUTH_CLIENT_SECRET` by default; set `ADDRESS_BOOK_CLIENT_ID` and `ADDRESS_BOOK_CLIENT_SECRET` in the dedicated file to use a separate OpenAPI application.

The OpenAPI application needs access-token, department-information, and department-member-information permissions. The safe minimum response thresholds can be adjusted with `ADDRESS_BOOK_MIN_DEPARTMENT_COUNT` and `ADDRESS_BOOK_MIN_USER_COUNT`.

## Schedule On Linux

On the deployment server, enable the systemd timer after the project has been updated:

```bash
cd /opt/chatbot
sudo bash scripts/install-address-book-sync.sh
sudo systemctl list-timers chatbot-address-book-sync.timer
sudo journalctl -u chatbot-address-book-sync.service -n 100 --no-pager
```

It runs every Sunday at 03:15 local server time with a random delay of up to ten minutes, persists missed runs across a reboot, and uses a lock so concurrent runs do not overlap. To run it immediately, use `sudo systemctl start chatbot-address-book-sync.service`.
