# Primo esperimento astronomico — esplorativo

Esito: nessun vantaggio predittivo rilevato nelle cinque definizioni provate. Questo non dimostra l'impossibilità di ogni altra ipotesi astrologica.

## Dati e metodo

796 estrazioni dal 27 settembre 2022 al 29 settembre 2026; 208 di avvio e 588 valutate dal 5 dicembre 2023. Archivio e supplemento hanno gli stessi SHA256 del backtest originale. Il concorso del 1 ottobre fornito tramite schermata non è incluso.

Posizioni calcolate con Astronomy Engine 2.1.19, contenuto verificato mediante SHA256. Coordinate geocentriche e settori eclittici tropicali; ora nominale 20:00 Europe/Rome, non verifica degli orari storici effettivi. Fase lunare divisa in otto settori; longitudini in dodici. Cinque regole fissate prima di eseguire questo esperimento, disponibili nel protocollo JSON. Lo storico era già stato esplorato: non è un holdout indipendente.

Ogni sestina usa solo le 208 estrazioni precedenti, con frequenze condizionate allo stato astronomico, regolarizzazione di 30 estrazioni e massimo tre numeri per decade. Nessuna ottimizzazione dei parametri dopo il risultato. Ciascun metodo produce una sola sestina per estrazione.

## Risultati

| Metodo | Numeri centrati totali | Media per sestina | p superiore esatto grezzo | p date sfalsate grezzo |
|---|---:|---:|---:|---:|
| Fase lunare | 234 | 0,398 | 0,544 | 0,420 |
| Settore del Sole | 225 | 0,383 | 0,770 | 0,660 |
| Mercurio, Venere, Marte | 227 | 0,386 | 0,725 | 0,455 |
| Giove, Saturno, Urano, Nettuno | 224 | 0,381 | 0,791 | 0,660 |
| Separazione Mercurio–Venere | 231 | 0,393 | 0,625 | 0,170 |

Atteso uniforme: 235,2 numeri centrati, media 0,400. Tutti i dieci p-value corretti con Holm sono 1. Non sono probabilità che il modello sia vero o falso.

Il riferimento frequenze a 208 estrazioni totalizza 220 hit. Superarlo in questo campione non implica superare il caso. Le 20.000 simulazioni di archivi uniformi danno media 235,246 e percentili 5–95% pari a 212–259 hit: tutti i risultati astronomici cadono in tale fascia. La simulazione usa una sestina fissa contro estrazioni uniformi, equivalente marginalmente sotto il nullo; non riaddestra i cinque modelli su ciascun archivio sintetico.

Le 199 traslazioni circolari spostano l'intera sequenza delle caratteristiche astronomiche rispetto alle estrazioni, mantenendo la dipendenza temporale tranne al punto di ricongiungimento. Sono un controllo diagnostico, non una prova causale. Sole e pianeti lenti possono rappresentare stagione/data; non si attribuiscono effetti ai pianeti.

## Verifiche e limiti

9 test automatici passati: orario estate/inverno, angoli, spareggi, correzione multipla, no-lookahead e protezione dei test precedenti. Una seconda implementazione PowerShell ha ricontrollato gli hit su tutte le 588 righe e ricostruito le cinque previsioni del 29 settembre. La ricostruzione indipendente delle previsioni è un controllo su una sola data; le effemeridi non sono state confrontate con un secondo motore.

I due test prospettici e il backtest storico sono rimasti identici byte per byte. Nessuna nuova sestina prospettica astronomica selezionata. Nessun profitto monetario calcolato. Non sono state provate stelle fisse, carte natali, astrologia siderale o numerologia.

File: `superenalotto-astronomy-protocol.json`, `superenalotto-astronomy.mjs`, `superenalotto-astronomy-results.json`, `superenalotto-astronomy.test.mjs`.

Documentazione del motore: https://github.com/cosinekitty/astronomy/blob/master/source/js/README.md
