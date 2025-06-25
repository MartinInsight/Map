class AirCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        this.markers = [];
        this.currentData = null;
        this.lastUpdated = null;
        this.filterControlInstance = null;

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 18,
            minZoom: 2
        }).addTo(this.map);

        this.map.setMaxBounds([
            [-85, -180],
            [85, 180]
        ]);

        this.map.on('zoomend', () => {
            const currentZoom = this.map.getZoom();
            if (currentZoom < this.map.getMinZoom()) {
                this.map.setZoom(this.map.getMinZoom());
            }
        });

        this.addControls();
        this.loadData();
    }

    async loadData() {
        try {
            const response = await fetch('data/us-air.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const rawData = await response.json();

            this.currentData = rawData.map(item => ({
                ...item,
                lat: item.lat || item.latitude_deg,
                lng: item.lng || item.longitude_deg,
                Airport: item.airport_code || 'Unknown'
            })).filter(item => item.lat && item.lng && item.Airport);

            if (this.currentData.length > 0) {
                this.lastUpdated = this.currentData[0].last_updated;
            }

            this.renderMarkers();
            this.addLastUpdatedText();
            this.addFilterControl();
        } catch (error) {
            console.error("Failed to load air data:", error);
            this.displayErrorMessage("항공 데이터를 로드하지 못했습니다. 잠시 후 다시 시도해주세요.");
        }
    }

    // TXO 기반 색상 계산 (혼잡도)
    getColorByTXO(txo) {
        if (txo == null) return '#cccccc'; // 데이터 없음
        
        if (txo >= 25) return '#d73027';   // 매우 혼잡 (빨강)
        if (txo >= 20) return '#fc8d59';   // 혼잡 (주황)
        if (txo >= 15) return '#fee08b';   // 보통 (노랑)
        if (txo >= 10) return '#d9ef8b';   // 원활 (연녹)
        return '#1a9850';                  // 매우 원활 (초록)
    }

    // TXO 기반 마커 크기 계산
    getRadiusByTXO(txo) {
        if (txo == null) return 6;
        
        if (txo >= 25) return 14;   // 매우 혼잡
        if (txo >= 20) return 12;   // 혼잡
        if (txo >= 15) return 10;   // 보통
        if (txo >= 10) return 8;    // 원활
        return 6;                   // 매우 원활
    }

    renderMarkers(data = this.currentData) {
        this.markers.forEach(marker => this.map.removeLayer(marker));
        this.markers = [];

        data.forEach(item => {
            const marker = L.circleMarker([item.lat, item.lng], {
                radius: this.getRadiusByTXO(item.average_txo),
                fillColor: this.getColorByTXO(item.average_txo),
                color: "#000",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            });

            marker.on({
                mouseover: (e) => {
                    this.map.closePopup();
                    const popup = L.popup()
                        .setLatLng(e.latlng)
                        .setContent(this.createPopupContent(item))
                        .openOn(this.map);
                },
                mouseout: () => {
                    this.map.closePopup();
                },
                click: () => {
                    this.map.closePopup();
                }
            });

            marker.addTo(this.map);
            this.markers.push(marker);
        });
    }

    createPopupContent(data) {
        return `
            <div class="air-tooltip">
                <h4>${data.Airport || 'Unknown Airport'}</h4>
                <p><strong>Avg TXO:</strong> ${data.average_txo?.toFixed(2) || 'N/A'} min</p>
                <p><strong>Scheduled:</strong> ${data.scheduled || 'N/A'}</p>
                <p><strong>Departed:</strong> ${data.departed || 'N/A'}</p>
                <p><strong>Completion:</strong> ${data.completion_factor || 'N/A'}%</p>
            </div>
        `;
    }

    displayErrorMessage(message) {
        if (this.errorControl) {
            this.map.removeControl(this.errorControl);
        }

        const errorControl = L.control({ position: 'topleft' });
        errorControl.onAdd = function() {
            const div = L.DomUtil.create('div', 'error-message');
            div.innerHTML = message;
            return div;
        };
        errorControl.addTo(this.map);
        this.errorControl = errorControl;
    }
}

window.AirCongestionMap = AirCongestionMap;
