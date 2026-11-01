# Reading a Netlify site without the proxy

Studio's built-in proxy already covers every site in the shipped catalogue, so this step is optional. It lets a Netlify site you own answer the browser directly, which also works when Studio runs somewhere that has no `api/fetch.js`.

A browser blocks Studio from reading another site's page or icons unless that site sends an `Access-Control-Allow-Origin` header. Netlify sends none by default.

## What to add

Create or edit `_headers` in the published folder of the Netlify site (the folder that holds `index.html`). Replace `https://your-studio.vercel.app` with the address Studio is served from.

```
/
  Access-Control-Allow-Origin: https://your-studio.vercel.app
/favicon.*
  Access-Control-Allow-Origin: https://your-studio.vercel.app
/apple-touch-icon*.png
  Access-Control-Allow-Origin: https://your-studio.vercel.app
/*.webmanifest
  Access-Control-Allow-Origin: https://your-studio.vercel.app
/icons/*
  Access-Control-Allow-Origin: https://your-studio.vercel.app
```

Deploy the site again. Then open Studio, clear the proxy address in Settings and harvest that site. The page and its icons are read straight from the browser.

## Limits

- The header only helps the paths listed. If the page declares an icon somewhere else, add that path too.
- Only one origin is allowed per rule. Add a second block of rules if Studio runs at two addresses.
- Sites protected with a Netlify password still cannot be read. Studio reports them as blocked and asks for the icon to be uploaded or the protection removed.
- The command line and the GitHub workflow do not need this, because Node is not subject to browser cross-origin rules.
