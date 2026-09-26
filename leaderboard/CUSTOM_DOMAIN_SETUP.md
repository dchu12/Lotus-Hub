# Connect lotuspickleballacademy.com (phone steps)

Goal: typing **lotuspickleballacademy.com** or **www.lotuspickleballacademy.com**
opens the October Challenge player page.

The code side is already done. There is a second Firebase Hosting site,
**lotuspickleballacademy**, whose home page redirects to
`/lotusoctoberchallenge`. It is deployed automatically with every change, and
you can check it at <https://lotuspickleballacademy.web.app>.

What's left is connecting your domain. You do this once, on your phone.
Allow about 15 minutes, plus waiting time for the internet to catch up.

## Part 1: Firebase (tells Firebase the domain is yours)

1. On your phone, open **console.firebase.google.com** in Chrome and sign in
   with the academy Google account. Tap the **lots-hub** project.
2. Open the menu (☰), then **Build**, then **Hosting**.
3. Scroll to the list of sites. Find **lotuspickleballacademy** (not
   lots-hub) and tap **View** or the three dots.
4. Tap **Add custom domain**.
5. Type `lotuspickleballacademy.com` and tap **Continue**.
6. Firebase shows a few **records**: usually one or two **TXT** records and
   one or two **A** records. Each one has a **Host** (often `@`) and a
   **Value** (numbers like `199.36.158.100`, or a long text).
   Keep this screen open. You'll copy these into Squarespace in Part 2.

## Part 2: Squarespace (points the domain at Firebase)

1. In a new tab, open **account.squarespace.com** and sign in.
2. Tap **Domains**, then **lotuspickleballacademy.com**, then **DNS**, then
   **DNS Settings**.
3. Under **Squarespace Defaults**, tap the **trash icon** to remove that
   preset. It points the domain at a Squarespace website, which would
   conflict with Firebase.
4. Under **Custom records**, tap **Add record** once for **each** record
   Firebase showed you:
   - **Type:** copy it (A or TXT)
   - **Host:** copy it (`@` means the bare domain)
   - **Data / Value:** copy it exactly
   - Tap **Save**
5. Go back to the Firebase tab and tap **Verify**. If it says "pending",
   that's normal. DNS changes take from a few minutes to a few hours.

## Part 3: www.lotuspickleballacademy.com

1. Back in Firebase, on the **lotuspickleballacademy** site, tap **Add custom
   domain** again.
2. Type `www.lotuspickleballacademy.com`.
3. Turn on **"Redirect to an existing website"** and choose
   `lotuspickleballacademy.com`.
4. Add the records it shows to Squarespace the same way. The Host will be
   `www`.

## When it's done

- Firebase shows **Connected** next to both domains. It then sets up the
  security certificate (the padlock), which can take up to a day.
- **lotuspickleballacademy.com** opens the challenge page. The address bar
  shows `lotuspickleballacademy.com/lotusoctoberchallenge`.
- Share and Story links made on that domain use it automatically.
- The old links (lots-hub.web.app/…) keep working.

## Admin sign-in on the new domain (optional)

To sign in to the admin page at `lotuspickleballacademy.com/lotus`, Firebase
has to trust the domain for Google sign-in:

1. Firebase: **Build**, then **Authentication**, then **Settings**, then
   **Authorized domains**, then **Add domain**.
2. Add `lotuspickleballacademy.com`, and `www.lotuspickleballacademy.com` too.

Until then, keep using the admin link <https://lots-hub.web.app/lotus>.

## Next month

To point the home page at another challenge, change the `redirects`
destination in `firebase.json` (target `academy`).
