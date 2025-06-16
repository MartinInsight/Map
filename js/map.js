class MapVisualizer {
    constructor() {
        this.map = L.map('map').setView([37.8, -96], 4);
        this.currentMode = 'inbound';
        this.geoJsonLayer = null;
        
        this.initBaseMap();
        this.loadData();
        this.setupControls();
    }

    initBaseMap() {
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(this.map);
    }

    // 기존 코드 변경
    async loadData() {
      try {
        const baseUrl = window.location.href.split('/').slice(0, 3).join('/');
        const [geoJson, metrics] = await Promise.all([
          fetch(`${baseUrl}/data/us-states.json`).then(checkStatus),
          fetch(`${baseUrl}/data/states-data.json`).then(checkStatus)
        ]);
        this.mergeData(await geoJson.json(), await metrics.json());
      } catch (e) {
        console.error("Data load error:", e);
        alert("데이터 로드 실패: " + e.message);
      }
    }
    
    function checkStatus(response) {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response;
    }

    mergeData(geoJson, metrics) {
        geoJson.features.forEach(feature => {
            const code = feature.properties.code;
            feature.properties.metrics = metrics[code] || {
                name: feature.properties.name,
                inbound: { delay: 0, color: 0, dwell: 0 },
                outbound: { delay: 0, color: 0, dwell: 0 }
            };
        });
        this.renderMap(geoJson);
    }

    renderMap(geoJson) {
        if (this.geoJsonLayer) {
            this.map.removeLayer(this.geoJsonLayer);
        }

        this.geoJsonLayer = L.geoJson(geoJson, {
            style: this.getStyle.bind(this),
            onEachFeature: this.onEachFeature.bind(this)
        }).addTo(this.map);
    }

    getStyle(feature) {
        const colorValue = feature.properties.metrics[this.currentMode].color;
        return {
            fillColor: this.getColorGradient(colorValue),
            weight: 1,
            opacity: 1,
            color: 'white',
            fillOpacity: 0.8
        };
    }

    getColorGradient(value) {
        // 색상 그래디언트: -4(빨강) ~ 0(회색) ~ +4(초록)
        const red = value < 0 ? Math.min(255, 100 + Math.abs(value)*40) : 200;
        const green = value > 0 ? Math.min(255, 100 + value*40) : 200;
        const blue = 200 - Math.abs(value)*20;
        return `rgb(${red}, ${green}, ${blue})`;
    }

    onEachFeature(feature, layer) {
        const mode = this.currentMode;
        const data = feature.properties.metrics[mode];
        
        layer.bindPopup(`
            <h3>${feature.properties.metrics.name}</h3>
            <hr>
            <strong>${mode.toUpperCase()} Metrics</strong>
            <ul>
                <li>Delay: <b>${data.delay}</b></li>
                <li>Dwell: <b>${data.dwell}</b></li>
                <li>Score: <b>${data.color}</b></li>
            </ul>
        `);
    }

    updateMap() {
        this.geoJsonLayer.setStyle(this.getStyle.bind(this));
        document.getElementById('mode-display').textContent = 
            this.currentMode === 'inbound' ? 'INBOUND' : 'OUTBOUND';
    }

    setupControls() {
        document.getElementById('toggle-mode').addEventListener('click', () => {
            this.currentMode = this.currentMode === 'inbound' ? 'outbound' : 'inbound';
            this.updateMap();
        });
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => new MapVisualizer());
