# Extensie-ID's bij `manifest.json`

`manifest.json` is strikt JSON — **geen** `//`-comments mogelijk.  
Dit bestand documenteert de ID's voor cross-extension messaging met U-Prevent Infused.

## Deze extensie (Bricks Infused)

| ID | Omgeving |
|----|----------|
| `mogkemhemedhcmoopdlfdjklgjlhgmnp` | Dev (unpacked + `key` in dit manifest) |
| `ebannlcfcakhaekmbeogkphbijghepbe` | Edge Add-ons (store, productie) |

## U-Prevent Infused (doel van `UPREVENT_EXT_IDS` in `background.js`)

| ID | Constante | Omgeving |
|----|-----------|----------|
| `pmlakmbpemkfccbhkdmcofagpipfchio` | `UPREVENT_EXT_IDS_PROD` | Edge Add-ons (store) |
| `hdneeeaikfhphigcmjcfppkclpoglhfb` | `UPREVENT_EXT_IDS_DEV` | Dev (unpacked + `key` in U-Prevent-manifest) |

U-Prevent moet Bricks whitelisten in `U-Prevent Infused/manifest.json` → `externally_connectable.ids` (zie `manifest.ids.md` daar).

Vóór store-upload Bricks: maak `UPREVENT_EXT_IDS_DEV` leeg (`[]`) in `background.js`.
