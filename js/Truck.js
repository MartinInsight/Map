import { fetchTruckData } from './google-sheets.js';

// 지도 초기화
const map = L.map('map').setView([37.8, -96], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
}).addTo(map);

// 색상 매핑
const COLOR_SCALE = {
    '-4': '#d73027',  // 심각한 지연
    '-3': '#fc8d59',
    '-2': '#fee08b',
    '-1': '#91cf60',  // 약간의 지연
    '0': '#f7f7f7',   // 정상
    '1': '#91cf60',
    '2': '#fee08b',
    '3': '#fc8d59',
    '4': '#d73027'
};

let currentMode = 'inbound';
let geoJsonLayer = null;

// 데이터 로드 및 지도 업데이트
async function loadData() {
    const [statesData, truckData] = await Promise.all([
        fetch('us-states.json').then(res => res.json()),
        fetchTruckData()
    ]);

    renderMap(statesData, truckData);
}

function renderMap(statesData, truckData) {
    if (geoJsonLayer) map.removeLayer(geoJsonLayer);

    geoJsonLayer = L.geoJson(statesData, {
        style: (feature) => getStyle(feature, truckData),
        onEachFeature: (feature, layer) => bindPopup(layer, feature, truckData)
    }).addTo(map);
}

function getStyle(feature, truckData) {
    const state = truckData.find(d => d.State === feature.properties.name);
    const colorKey = currentMode === 'inbound' ? 'InboundColor' : 'OutboundColor';
    const colorValue = state ? state[colorKey] : 0;

    return {
        fillColor: COLOR_SCALE[colorValue] || '#f7f7f7',
        weight: 1,
        opacity: 1,
        color: 'white',
        fillOpacity: 0.7
    };
}

function bindPopup(layer, feature, truckData) {
    const state = truckData.find(d => d.State === feature.properties.name);
    
    layer.bindPopup(`
        <div class="tooltip-content">
            <h4>${feature.properties.name}</h4>
            <p><strong>Inbound Delay:</strong> ${state?.InboundDelay?.toFixed(2) || 'N/A'} days</p>
            <p><strong>Outbound Delay:</strong> ${state?.OutboundDelay?.toFixed(2) || 'N/A'} days</p>
            <p><strong>Dwell Time:</strong> ${state?.DwellInbound?.toFixed(2) || 'N/A'} days</p>
        </div>
    `);
}

// 토글 이벤트
document.getElementById('inboundBtn').addEventListener('click', () => {
    currentMode = 'inbound';
    document.getElementById('inboundBtn').classList.add('active');
    document.getElementById('outboundBtn').classList.remove('active');
    loadData();
});

document.getElementById('outboundBtn').addEventListener('click', () => {
    currentMode = 'outbound';
    document.getElementById('outboundBtn').classList.add('active');
    document.getElementById('inboundBtn').classList.remove('active');
    loadData();
});

// 초기 로드
document.addEventListener('DOMContentLoaded', loadData);
