# AsteriaMC.pl - Item Shop

Gotowy item shop dla serwera AsteriaMC.pl.

## Co jest zrobione
- frontend sklepu (rangi, klucze, koszyk)
- checkout z polem nick gracza i opcjonalnym e-mailem
- wybór metody płatności: PaySafeCard / BLIK
- backend API do zapisu zamówień do pliku `data/orders.json`

## Uruchomienie lokalne
1. `npm install`
2. `npm start`
3. Otwórz `http://localhost:3000`

## Logo
Wgraj logo do pliku:
- `assets/asteria-logo.png`

## Uwaga o płatnościach
Aktualnie sklep zapisuje zamówienie lokalnie i nie pobiera realnej płatności.
Następny krok to podłączenie operatora płatności i webhooków.
