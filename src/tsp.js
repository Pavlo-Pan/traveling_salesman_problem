require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const API_KEY = process.env.ORS_API_KEY;
const ORS_URL = 'https://api.openrouteservice.org/v2/matrix/driving-car';
const saveRouteGeoJSON = require('./saveRouteGeoJSON.js');
const generateMapHtml = require('./generateMapHTML.js');
const cities = JSON.parse(fs.readFileSync(path.join(__dirname, 'cities.json'), 'utf-8'));

async function getDistanceMatrix(locations) {
    const BATCH_SIZE = 50;
    const total = locations.length;
    const coords = locations.map(c => [c.lon, c.lat]);
    const matrix = Array(total).fill(null).map(() => Array(total).fill(Infinity));

    for (let i = 0; i < total; i += BATCH_SIZE) {
        const srcIndices = Array.from({ length: Math.min(BATCH_SIZE, total - i) }, (_, k) => i + k);
        const sources = coords.slice(i, i + BATCH_SIZE);

        for (let j = 0; j < total; j += BATCH_SIZE) {
            const dstIndices = Array.from({ length: Math.min(BATCH_SIZE, total - j) }, (_, k) => j + k);
            const destinations = coords.slice(j, j + BATCH_SIZE);

            const response = await axios.post(ORS_URL, {
                locations: sources.concat(destinations),
                sources: srcIndices.map(k => k - i),
                destinations: dstIndices.map(k => k + sources.length - j),
                metrics: ["distance"],
                units: "km"
            }, {
                headers: {
                    Authorization: API_KEY,
                    "Content-Type": "application/json"
                }
            });

            const distances = response.data.distances;
            for (let si = 0; si < srcIndices.length; si++) {
                for (let di = 0; di < dstIndices.length; di++) {
                    matrix[srcIndices[si]][dstIndices[di]] = distances[si][di];
                }
            }
        }
    }

    return matrix;
}

function bestInsertion(matrix, start = 0) {
    const n = matrix.length;
    const unvisited = new Set(Array.from({ length: n }, (_, i) => i));
    const route = [start];
    unvisited.delete(start);

    let nearest = -1;
    let minDist = Infinity;
    for (let i of unvisited) {
        if (matrix[start][i] < minDist) {
            nearest = i;
            minDist = matrix[start][i];
        }
    }
    route.push(nearest);
    unvisited.delete(nearest);

    while (unvisited.size > 0) {
        let bestCity = null;
        let bestPos = -1;
        let bestCost = Infinity;

        for (let city of unvisited) {
            for (let i = 0; i < route.length; i++) {
                const j = (i + 1) % route.length;
                const a = route[i], b = route[j];
                const cost = matrix[a][city] + matrix[city][b] - matrix[a][b];
                if (cost < bestCost) {
                    bestCity = city;
                    bestPos = j;
                    bestCost = cost;
                }
            }
        }

        route.splice(bestPos, 0, bestCity);
        unvisited.delete(bestCity);
    }

    return route;
}

function twoOpt(route, matrix) {
    let improved = true;
    while (improved) {
        improved = false;
        for (let i = 1; i < route.length - 2; i++) {
            for (let j = i + 1; j < route.length - 1; j++) {
                const A = route[i - 1], B = route[i];
                const C = route[j], D = route[j + 1];
                const current = matrix[A][B] + matrix[C][D];
                const swapped = matrix[A][C] + matrix[B][D];
                if (swapped < current) {
                    route = route.slice(0, i).concat(route.slice(i, j + 1).reverse(), route.slice(j + 1));
                    improved = true;
                }
            }
        }
    }
    return route;
}

function fixCityOrder(route, cities, pairs) {
    for (const { from, to } of pairs) {
        const fromIdx = cities.findIndex(c => c.name === from);
        const toIdx = cities.findIndex(c => c.name === to);
        if (fromIdx === -1 || toIdx === -1) continue;
        const iFrom = route.indexOf(fromIdx);
        const iTo = route.indexOf(toIdx);
        if (iFrom !== -1 && iTo !== -1) {
            route = route.filter(i => i !== toIdx);
            const insertAt = route.indexOf(fromIdx) + 1;
            route.splice(insertAt, 0, toIdx);
        }
    }
    return route;
}

function manualAdjustments(route, cities, sequence) {
    const indexMap = Object.fromEntries(cities.map((c, i) => [c.name, i]));
    const indexes = sequence.map(name => indexMap[name]).filter(i => i !== undefined);

    for (let i = 0; i < indexes.length - 1; i++) {
        const fromIdx = route.indexOf(indexes[i]);
        const toIdx = route.indexOf(indexes[i + 1]);

        if (fromIdx === -1 || toIdx === -1) continue;

        route.splice(toIdx, 1);
        const insertAfter = route.indexOf(indexes[i]);
        route.splice(insertAfter + 1, 0, indexes[i + 1]);
    }

    return route;
}

(async () => {
    try {
        const startCityName = process.argv[2] || 'Berlin';
        const manualSequences = process.argv.slice(3); // все оставшиеся аргументы

        const startIdx = cities.findIndex(c => c.name === startCityName);
        if (startIdx === -1) throw new Error('Начальный город не найден');

        console.log("Загрузка матрицы расстояний...");
        const matrix = await getDistanceMatrix(cities);

        console.log("Глобальный маршрут (best insertion)...");
        let route = bestInsertion(matrix, startIdx);

        console.log("Оптимизация маршрута (2-opt)...");
        route = twoOpt(route, matrix);

        console.log("Фиксация порядка городов...");

        for (const seq of manualSequences) {
            const manualSequence = seq.split(',').map(s => s.trim()).filter(Boolean);
            if (manualSequence.length > 1) {
                console.log("Ручная корректировка порядка городов:", manualSequence.join(' → '));
                route = manualAdjustments(route, cities, manualSequence);
            }
        }

        const orderedNames = route.map(i => cities[i].name);
        console.log("Маршрут:");
        console.log(orderedNames.join(" → "));

        let totalDistance = 0;
        for (let i = 0; i < route.length - 1; i++) {
            totalDistance += matrix[route[i]][route[i + 1]];
        }
        console.log(`Общая длина маршрута: ${totalDistance.toFixed(2)} км`);

        saveRouteGeoJSON(cities, route);
        generateMapHtml();
    } catch (err) {
        console.error("Ошибка:", err.message);
    }
})();
