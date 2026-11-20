# Dashboard Diverso

Dashboard de productos de Tiendanube para Diverso by Pili: foto, precio, unidades vendidas, facturación, stock, días publicado y días de stock. A cada producto se le asigna una familia o línea y sus creativos, para organizar la pauta.

- **Sitio:** https://arielharari28-cloud.github.io/diverso-dashboard/ (GitHub Pages, rama `main`)
- **Datos:** Firestore, proyecto `diverso-dashboard`
- **Login:** Google, solo con los mails autorizados en las reglas de Firestore
- **Sincronización:** `.github/workflows/sync.yml` corre `scripts/sync.mjs` cada 3 horas. También se puede correr a mano desde Actions → "Sincronizar Tiendanube" → Run workflow.

## Secrets necesarios (Settings → Secrets and variables → Actions)
- `TIENDANUBE_TOKEN`: token de la aplicación a medida "Dashboard Diverso" (solo lectura de productos y pedidos)
- `TIENDANUBE_STORE_ID`
- `FIREBASE_SERVICE_ACCOUNT`: contenido completo del .json de la cuenta de servicio

## Colecciones
- `productos`, `sync`: las escribe solo la sincronización
- `familias`, `asignaciones`: las edita el equipo desde el dashboard (familia y creativos de cada producto)
