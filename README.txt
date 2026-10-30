ONO FOOD WEBSITE - COMPACT SOURCE BUNDLE

This archive keeps the complete editable customer/admin frontend, backend API,
PostgreSQL migrations and seed scripts, tests, menu photos/video, and the
temporary Render preview configuration.

To stay below 25 MB, this compact bundle omits the bundled PostgreSQL runtime,
generated node_modules, duplicate single-file HTML exports, and the old
one-click launcher that depended on the bundled database. The original
ONO-Food-Website.7z remains unchanged. Install Node.js and PostgreSQL before
running this compact copy locally.

LOCAL SETUP

1. Install Node.js 22 or later and PostgreSQL 14 or later.
2. In PostgreSQL, create a database named ono_food and an application user
   named ono_app with permission to create tables in that database.
3. Copy backend/.env.example to backend/.env. Set DATABASE_URL to your local
   PostgreSQL credentials and set different random SESSION_SECRET and
   TRACKING_SECRET values (each at least 32 characters). Keep backend/.env
   private and do not put it in a shared archive or Git repository.
4. Open PowerShell in the backend folder and run:

   npm ci
   npm run db:migrate
   npm run db:seed

5. Create the first owner account by setting ADMIN_BOOTSTRAP_EMAIL,
   ADMIN_BOOTSTRAP_NAME, ADMIN_BOOTSTRAP_PHONE, and a private password of at
   least 12 characters in the current PowerShell session, then run:

   npm run admin:create

   Remove those ADMIN_BOOTSTRAP_* environment values immediately afterward.
6. Run Start ONO Food.cmd. The customer site is at http://localhost:3000/ and
   the owner dashboard is at http://localhost:3000/admin.
7. Run npm test from backend/ to execute the unit and catalog tests.

TEMPORARY ONLINE PREVIEW

render.yaml defines a temporary Render preview with a fresh online PostgreSQL
database. Keep the source repository private. It does not transfer any local
accounts or orders. Render's free web service can sleep while idle and its free
PostgreSQL expires after 30 days; use this for sharing/testing, not ongoing
customer orders. See https://render.com/docs/free.

The preview URL is public to anyone who has the link. Use a unique strong owner
password, and remove the ADMIN_BOOTSTRAP_* variables from Render after the
initial setup hook creates the owner account.
