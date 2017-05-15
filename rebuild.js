// Registers a cron(-ish) job for tippecanoe that executes daily at midnight
var fs = require('fs');
var pgp = require('pg-promise')();
var QueryStream = require('pg-query-stream');
var JSONStream = require('JSONStream');
var path = require('path');
var Tippecanoe = require('./tippecanoe');


var tippecanoe = new Tippecanoe({
  maxzoom: 17,
  minzoom: 12,
  force: true,
  docker: true
});

function makeMbtiles(name, paths, cb) {
  console.log('Building tiles...');
  mbtilesName = name + '.mbtiles';
  tippecanoe.run(paths, path.join('build/mbtiles', mbtilesName), e => {
    if (e) {
      throw e
    }
    fs.rename(path.join('build/mbtiles', mbtilesName),
              path.join('data/mbtiles', mbtilesName),
              function(err) {
                if (err) {
                  cb(err);
                }
                console.log(name + ' tiles built...');
                cb()
              });
  });
}

function updateTiles(cb) {
  console.log('Extracting layers from database...');
  // connect to database, write geojson file
  var db = pgp(process.env.DATABASE_URL);
  db.connect();

  // TODO: implement query helper(s)?

  var QueryStream = require('pg-query-stream');
  var JSONStream = require('JSONStream');

  var tiles = {
    routing: {
      routing_info: `
        SELECT 'Feature' as type,
               ST_AsGeoJSON(ST_Transform(geom, 4326), 7)::json geometry,
               json_build_object('grade', grade) properties
          FROM routing_info`
    }
  };

  for (let tileName of Object.keys(tiles)) {
    let layers = tiles[tileName];
    let promises = [];

    for (let layerName of Object.keys(layers)) {
      let sql = layers[layerName];
      let qs = new QueryStream(sql);
      let stream = db.stream(qs, s => {
        let filePath = path.join(process.cwd(),
                                 './data/overlay',
                                  layerName + '.geojson');
        let handle = fs.createWriteStream(filePath);
        handle.on('open', fd => {
          handle.write('{"type": "FeatureCollection",');
          handle.write(' "features": ');
          s.pipe(JSONStream.stringify()).pipe(handle, {'end': false });
          s.on('end', () => {
            handle.write('}');
            handle.end();
          });
        });
      });
      promises.push(stream);
    }

    Promise.all(promises)
      .then(d => {
        let paths = {};
        Object.keys(layers).forEach(l => {
          paths[l] = path.join('./data/overlay', l + '.geojson');
        });
        makeMbtiles(tileName, paths, cb);
      });
  }
}

module.exports = updateTiles;
