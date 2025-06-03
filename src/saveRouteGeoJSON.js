const fs = require('fs');
const path = require('path');

/**
 * Сохраняет маршрут в формате GeoJSON.
 * @param {Array} cities - массив городов с полями { name, lat, lon }.
 * @param {Array} route - массив индексов, указывающих порядок обхода.
 * @param {string} filename - имя файла для сохранения (по умолчанию route.geojson).
 */
function saveRouteGeoJSON(cities, route, filename = 'route.geojson') {
  const coordinates = route.map(index => [cities[index].lon, cities[index].lat]);

  const geojson = {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: coordinates
    },
    properties: {}
  };

  const filePath = path.join(__dirname, filename);
  fs.writeFileSync(filePath, JSON.stringify(geojson, null, 2), 'utf-8');
  console.log(`Маршрут сохранён в ${filePath}`);
}

module.exports = saveRouteGeoJSON;
