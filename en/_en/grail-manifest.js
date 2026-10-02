/* ——————————————————————————————————————————————————————————————————————
   ЛИЧНЫЙ АРХИВ — the pieces listed on mockups/final1/grail.html
   ——————————————————————————————————————————————————————————————————————

   ONE ENTRY PER PIECE. Put the photograph in this folder, add a line here,
   save, reload the page. The order here is the order down the page, one
   full-height band each.

   file     the photograph's filename, in THIS folder. A path with a slash in
            it is read relative to this folder, if a piece ever needs to point
            somewhere else in assets/.
   nm       the piece's name
   br       the designer
   cond     Condition — condition, in words: Excellent / Very good / Good
   season   Season — e.g. 'FW 2003'
   country  Made in
   desc     OPTIONAL. The paragraph under the facts. Leave it out and the piece
            gets the standard archive wording, which is what most should use —
            write one only when a piece needs something said about it.
   sold     OPTIONAL. true greys out «Make an offer» — the piece is gone, or
            an offer on it is already being dealt with.

   No prices. This section never shows one: every piece prints «Price on request» and the customer makes an offer. There is no price field to fill
   in, on purpose.

   ——————————————————————————————————————————————————————————————————————
   ATTRIBUTION NOTE — read before this goes near a client.

   The five real entries below were identified from the photographs alone.
   Every line marked  // ? CHECK LABEL  is a judgement call, not a fact off a
   care tag. Condition in particular CANNOT be graded from a photograph — the
   values below are what the pictures do not contradict, nothing more. Check
   each piece in hand and against its label before this page is shown.

   Confidence, piece by piece:
     05  Balmain military tailcoat — high. Decarnin-era house signature.
     04  Balmain sequin mini — high on house, soft on season.
     01  Lanvin draped dress — moderate. Construction reads Elbaz; unverified.
     02  Céline leather colour-block peplum — owner's call. Colour code 38NO
         is consistent with the house. Season and country are guesses.
     03  Céline white crepe fishtail skirt — owner's call. Nothing in the
         photograph confirms or contradicts it. Season and country are guesses.
   —————————————————————————————————————————————————————————————————————— */

window.GRAIL = [

  {file:'W02011953C7A_17_2_-removebg-preview.png',
   nm:'Draped one-shoulder dress',
   br:'Lanvin',                               // ? CHECK LABEL
   cond:'Excellent',                           // ? CHECK IN HAND
   season:'FW 2010',                          // ? CHECK LABEL
   country:'France',                         // ? CHECK LABEL
   desc:'The dress is built on a single movement: a length of silk is caught at the right shoulder in a soft knot and falls away, gathering into deep drapery down the left side. The fabric is dense with a muted sheen, turning from graphite to almost black as it moves. The shape is held by the weight of the fabric, not by construction: no darts, no fastenings, no trim. Knee length, with the other shoulder and arm left bare.'},

  {file:'20M964106_38NO_Black_1_-removebg-preview.png',
   nm:'Colour-block leather peplum top',
   br:'Céline',                               // owner's attribution, not off a label
   cond:'Excellent',                           // ? CHECK IN HAND
   season:'FW 2013',                          // ? CHECK LABEL
   country:'Italy',                          // ? CHECK LABEL
   desc:'A sleeveless top pieced from four colour panels: smooth black leather and burgundy suede on the bodice, deep green and olive on the peplum. The seams run on the diagonal, so the colour reads not as a seam but as a cut across the figure. The peplum sits at the waist and flares into a stiff bell, its shape held by the leather itself. The contrast of the two textures, polished and matt, shows only up close.'},

  {file:'16P4009210_100_White_1_-removebg-preview.png',
   nm:'Cascading ruffle skirt',
   br:'Céline',                               // owner's attribution, not off a label
   cond:'Excellent',                           // ? CHECK IN HAND
   season:'SS 2016',                          // ? CHECK LABEL — '16P' reads as printemps 2016
   country:'Italy',                          // ? CHECK LABEL
   desc:'A skirt in dense crêpe: a smooth, almost sculptural fit from waist to hip, then a cascade of ruffles gathered into a fishtail silhouette. The ruffles are cut on the bias and fall asymmetrically: the hem sits above the knee at the front and drops to the ankle at the back and sides. The crêpe holds its volume without a lining and does not crease at the folds. A cool white with no cream in it.'},

  {file:'Balmain_3954_302B_1_-removebg-preview.png',
   nm:'Sequinned mini dress',
   br:'Balmain',
   cond:'Excellent',                           // ? CHECK IN HAND — вышивка, смотреть на утраты
   season:'FW 2012',                          // ? CHECK LABEL
   country:'France',                         // ? CHECK LABEL
   desc:'A mini dress sequinned all over: a gold ground and a purple baroque pattern laid out symmetrically about the centre line. The shoulders are sharpened by sewn-in pads, the sleeve narrow and long — the silhouette the house is known for above all. Hand embroidery on a mesh base, the sequins overlapping like scales and changing tone as they turn. A heavy piece: all its weight hangs from the shoulder seam.'},

  {file:'7851_1_-removebg-preview.png',
   nm:'Military-cut jacket with epaulettes',
   br:'Balmain',
   cond:'Very good',                      // ? CHECK IN HAND — смотреть крепления знаков
   season:'FW 2010',                          // ? CHECK LABEL — SS 2010 тоже возможен
   country:'France',                         // ? CHECK LABEL
   desc:'A jacket in dense khaki cotton: stand collar, fitted bodice, two rows of engraved metal buttons and long fronts cut away at an angle into tails. Epaulettes of gold chain fringe hold the shoulders; the chest carries a set of orders, medals and embroidered patches. Military uniform is taken apart here and put back together as evening wear: the cut is regulation, the trim is not. Buttoned tabs at the cuffs, fully lined.'},

];

/* ——————————————————————————————————————————————————————————————————————
   LENGTH FILL — the page is shown at 50 pieces, the count of the owner's Drive
   folder «Коллекция Миши» (set 19 Sep 2026, evening; it ran at 14 before).

   Until there are 50 real entries above, they are repeated in order up to
   that count. Every repeat is marked `placeholder: true`, so it carries the
   «placeholder» flag over its shot.

   Each real entry added above pushes one repeat off the end. When the list
   reaches GRAIL_FINAL_COUNT on its own this block does nothing — delete it.
   (A 50-band version, the full count of the owner's Drive folder, is parked
   in mockups/_versions/2026-09-19-grail-50-pieces/.)
   —————————————————————————————————————————————————————————————————————— */
window.GRAIL_FINAL_COUNT = 50;

(function(){
  const real = window.GRAIL.slice();
  for(let i = 0; real.length && window.GRAIL.length < window.GRAIL_FINAL_COUNT; i++){
    window.GRAIL.push(Object.assign({}, real[i % real.length], {placeholder:true}));
  }
})();
