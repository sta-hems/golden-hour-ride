# Golden Hour Ride

A proof-of-concept indoor cycling ride that runs in the browser (Three.js, one `index.html`).

Live: https://golden-hour-ride.space.fast/ · Leckhampton loop: https://golden-hour-ride.space.fast/?course=leckhampton

## What's in it

- A choice of courses from the Course menu: an invented mountain valley, a real 11.9 km Leckhampton loop built from Environment Agency lidar, dressed as the 19th-century hill (sheep, hay stooks, quarry smoke), and real roads in Germany built from the states' 1 m terrain survey (see below).
- Four looks: Golden, Overcast, Rain and Mist. Buttons at the top, keys 1–4, or by voice.
- Four seasons from the Season menu, or by voice (“spring”, “Herbst”, …): spring green with trees in blossom, summer, autumn colours with the leaves thinning, and winter with snow on the ground and bare trees. The choice is kept in the browser; `?season=winter` sets it for one visit.
- A small map of the course in the top left corner, with the towns and villages, the cars, and the height profile; click it for a bigger one.
- Skip forward and back 250 m with the arrow keys.
- Hide everything on screen for a clean view: the Hide info button, the H key, or say "hide". Press H, click, or say "show" to bring it back.
- Power from a slider, or from a Bluetooth trainer (Chrome or Edge). If the trainer supports resistance control (FTMS), the ride also sends it the road gradient, so climbs feel harder; the button shows "Trainer: power and gradient" or "Trainer: power only". The trainer feels half the road gradient by default; the − and + buttons beside the trainer button change that in steps of 10 %, from off to the full gradient, and the choice is kept in the browser (`?hills=` sets it for one visit). With voice on, say "easier" or "harder" to move it by 20 %, "flat" for off, or "full" for all of it. The last trainer is remembered: the button reads "Reconnect trainer" and rejoins it without the browser's device list where Chrome allows that, and a dropped connection is retried automatically.
- Descents count half in the speed model and the rider brakes above 54 km/h, so downhill speed stays sensible.

## Courses from German survey data

Every German state publishes its 1 m terrain survey (DGM1) as open data, and [hoehendaten.de](https://hoehendaten.de) serves all of it through one API. `tools/build_course_de.py` turns a route into a course from it:

```bash
python3 tools/build_course_de.py tools/courses/idstein.json
```

A course file (see `tools/courses/idstein.json`) gives an `id`, a `name`, and the route: `waypoints` (latitude, longitude) routed along the roads by OpenStreetMap, or `"gpx": "my-ride.gpx"` for a track of your own. The script downloads the 1 km terrain tiles it needs (cached in `tools/.cache`, about 20 tiles a minute), takes buildings, woods and hedges from OpenStreetMap, writes `assets/<id>.js` and `assets/<id>_osm.js`, and adds the course to `assets/courses.js`, which feeds the course menu in the ride. `--tile file.tif` uses a DGM1 GeoTIFF you already have instead of downloading that tile.

What the script does with the map:

- **Bridges.** The terrain model has no bridges, so where OpenStreetMap marks the route as a bridge the road runs straight from one end to the other and the ride builds a deck with a kerb, a rail and piers; the valley underneath keeps its shape.
- **Junctions.** The first stretch (up to 150 m) of every road that meets the route is laid too, settling from the route's height onto the ground, so junctions look like junctions.
- **Side of the road.** `"drive": "right"` (the default) keeps the rider to the right, as in Germany; Leckhampton keeps left.
- **Doubling back.** If the router sends the route out and back along the same road, the script warns: move a waypoint onto the road you want to ride.

The first German course is a 5.2 km loop just west of Idstein in the Taunus: the L 3274 to the K 707, south on the K 708, back north on the B 275 over the bridge, starting on the Hessen test tile near Oberauroff. Heights: Geobasisdaten © Hessische Verwaltung für Bodenmanagement und Geoinformation, dl-de/by-2-0.

## Plan your own route

Press **Routes** in the ride, type a start and one or more places to ride by (towns, villages, addresses, or “lat, lon”), tick *back to the start* for a round trip, and press **Build the course**. The page finds the places (OpenStreetMap Nominatim), routes along the roads (OSRM), fetches the terrain tiles from hoehendaten.de, takes bridges, side roads, buildings and woods from OpenStreetMap, and keeps the finished course in the browser (IndexedDB), with the terrain tiles, so routes nearby build faster. You can set off within about half a minute: the course is first built from the open Terrarium terrain tiles, and a background worker then builds it again from the 1 m survey (a tile every 3 seconds, as the service allows) while you ride. When that is done, *Switch now* reloads the course at the spot you have reached, in the same ride; otherwise the next ride uses it. Mark favourites with ★: they come first in the course menu. Germany only, as the terrain is the German state surveys. The code is in `js/` (`builder.js` does what `tools/build_course_de.py` does, in the browser).

## Radio, news boards and traffic

- **Radio**: SWR3, hr3, BBC Radio 1, 2 and 3. The button steps through them; or say the station's name, “radio off”, “louder”, “quieter”.
- **News**: boards beside the road every 1 to 1.5 km with the latest headlines from tagesschau.de and hessenschau.de (BBC News on British courses). The News button turns them off.
- **Traffic**: a few cars, about one for every 1.5 km, both ways (real models if you add them, see below), with the soft hum of an electric car and the hiss of their tyres. They slow for bends (braking before them, not in them). A car coming up behind waits well back until the other lane is clear for 320 m and no tight bend is coming, then passes with more than 2 m to spare and pulls in again 20 m ahead. The Traffic button turns them off.
- **Sound**: a mixer for everything you hear (wind and tyres, rain, traffic, radio). While the radio plays, wind and tyres drop back on their own; untick that in the mixer, or turn them right down.
- **Voice** listens in German on German courses and in English on British ones; both sets of words work (“Regen”, “Nebel”, “Sonne”, “weiter”, “zurück”, “leichter”, “schwerer”, …).

## Real car models (optional)

Out of the box the traffic uses simple cars built in code (hatchback, saloon, estate). It can drive real glTF models instead, which look far better; they aren't in the repository, as they are large (about 12 MB each) and come under their authors' own licences.

1. On [Sketchfab](https://sketchfab.com), find cars marked *Downloadable*, licensed **CC Attribution** or **CC0** (not *NonCommercial*), with at most about 50,000 triangles. The series by [Daniel Zhabotinsky](https://sketchfab.com/DanielZhabotinsky) works well together: *Milano '95*, *Kiri '86*, *Sigil '07*, *Fairheaven SW '84*, *Shvan '92* (CC BY 4.0, made-up makes).
2. Download each as **glTF** and unzip it into its own folder in `assets/cars/`, e.g. `assets/cars/milano_95_-_low_poly_model/scene.gltf` (with `scene.bin`, `textures/` and `license.txt`).
3. List them in [`assets/cars/cars.json`](assets/cars/cars.json): the file, title, author, licence and source (all in each `license.txt`), the real car's `length` in metres, and `rotate` (degrees) if the model faces the wrong way. `cars.json` already lists the five above.

The ride scales each model to its length, turns it lengthways and nose first, sets it on the road, and credits it at the bottom of the screen, as CC BY asks. Models listed but not downloaded are skipped; with none, the built-in cars drive. `tools/car-preview.html` shows the models side by side (`?view=front`, `?view=side`; `?built` for the built-in ones), with an arrow where the nose should point.

## Run it locally

```bash
python3 serve.py
```

`serve.py` serves the page like `python3 -m http.server`, and also passes on the requests a web page may not make itself (hessenschau.de's news feed, BBC News, a busy map server). Without it the ride works, only those extras go missing.

Then open http://localhost:8791/.

## Layout

- `index.html` – the whole ride.
- `assets/` – textures and course data. `textures.js` is an embedded copy of the textures, used only when the page is opened straight from disk.
- `tools/` – scripts that build the Leckhampton course data.
- `deploy.sh` – publishes to Spacefast.

## Credits

- Textures: Poly Haven (CC0).
- Terrain: Environment Agency LiDAR Composite DTM, Open Government Licence v3.0.
- Roads, woodland and field boundaries: © OpenStreetMap contributors, ODbL.
- 3D engine: Three.js (MIT), loaded from jsDelivr.

## Licence

The code is released under the MIT licence: see `LICENSE`. Use it, change it, build your own ride.

The MIT licence covers the code only. The course data in `assets/leckhampton.js` and `assets/leckhampton_osm.js` is derived from the sources credited above and stays under their terms: the Open Government Licence v3.0 for the terrain and the ODbL for the OpenStreetMap data. If you share or adapt that data, keep those credits.
