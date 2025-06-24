class TruckCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        this.stateLayer = null;
        this.currentMode = 'inbound';
        this.metricData = null;
        this.geoJsonData = null;
        this.initialized = false;
        this.controlDiv = null;
        this.errorControl = null; // 에러 컨트롤 인스턴스 저장

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 18,
            minZoom: 2 // 최소 줌 레벨 설정 (고무줄 현상 방지)
        }).addTo(this.map);

        // 최대 줌 아웃 범위 제한
        this.map.setMaxBounds([
            [-85, -180],
            [85, 180]
        ]);

        // 줌 제한 로직 (minZoom과 maxBounds가 함께 작동하도록)
        this.map.on('zoomend', () => {
            const currentZoom = this.map.getZoom();
            // minZoom보다 작아지려고 하면 minZoom으로 고정
            if (currentZoom < this.map.getMinZoom()) {
                this.map.setZoom(this.map.getMinZoom());
            }
        });

        this.init();
    }

    async init() {
        try {
            const [geoJson, sheetData] = await Promise.all([
                fetch('data/us-states.json').then(res => {
                    if (!res.ok) throw new Error("GeoJSON fetch error");
                    return res.json();
                }),
                this.fetchSheetData()
            ]);

            this.geoJsonData = geoJson;
            this.metricData = sheetData;

            this.renderMap();
            this.addControls();
            this.addFilterControl();
            this.initialized = true;
        } catch (err) {
            console.error("Initialization failed:", err);
            this.showError("트럭 데이터를 로드하지 못했습니다. 잠시 후 다시 시도해주세요.");
        }
    }

    async fetchSheetData() {
        try {
            const res = await fetch('data/us-truck.json');
            if (!res.ok) throw new Error("Truck data fetch error");
            return await res.json();
        } catch (err) {
            console.warn("Truck data fetch failed, using fallback data.");
            // 오류 발생 시 최소한의 더미 데이터 반환
            return {
                'AL': { name: 'Alabama', inboundDelay: 0, inboundColor: 0, outboundDelay: 0, outboundColor: 0, dwellInbound: 0, dwellOutbound: 0 },
                'TN': { name: 'Tennessee', inboundDelay: 0, inboundColor: 0, outboundDelay: 0, outboundColor: 0, dwellInbound: 0, dwellOutbound: 0 }
                // 다른 주에 대한 기본값도 필요하다면 추가
            };
        }
    }

    renderMap() {
        if (this.stateLayer) this.map.removeLayer(this.stateLayer);

        this.stateLayer = L.geoJSON(this.geoJsonData, {
            style: this.getStyle.bind(this),
            onEachFeature: this.bindEvents.bind(this)
        }).addTo(this.map);
    }

    getStyle(feature) {
        const stateCode = feature.id;
        const data = this.metricData[stateCode] || {};
        const colorValue = this.currentMode === 'inbound'
            ? data.inboundColor
            : data.outboundColor;

        return {
            fillColor: this.getColor(colorValue),
            weight: 1,
            opacity: 1,
            color: 'white',
            fillOpacity: 0.7
        };
    }

    getColor(value) {
        const colors = {
            '-3': '#d73027',
            '-2': '#f46d43',
            '-1': '#fdae61',
            '0': '#ffffbf',
            '1': '#a6d96a',
            '2': '#66bd63',
            '3': '#1a9850'
        };
        return colors[value] || '#cccccc';
    }

    bindEvents(feature, layer) {
        const stateCode = feature.id;
        const data = this.metricData[stateCode] || {};

        layer.on({
            mouseover: (e) => {
                // 마우스가 해당 주 영역에 들어왔을 때 해당 주의 중심 좌표를 계산
                const center = layer.getBounds().getCenter();
                this.showTooltip(center, data); // 툴팁을 주의 중심에 표시
                layer.setStyle({
                    weight: 3,
                    color: '#666',
                    dashArray: '',
                    fillOpacity: 0.9
                });
            },
            mouseout: (e) => {
                this.map.closePopup(); // 마우스가 벗어나면 툴팁 닫기
                this.stateLayer.resetStyle(layer); // 원래 스타일로 되돌리기
            },
            click: () => this.zoomToState(feature)
        });
    }

    // showTooltip 함수의 첫 번째 인자를 마우스 이벤트 객체(e)에서 LatLng 객체로 변경
    showTooltip(latlng, data) {
        if (!this.initialized) return;

        const format = (v) => isNaN(Number(v)) ? '0.00' : Math.abs(Number(v)).toFixed(2);
        const isInbound = this.currentMode === 'inbound';
        const delay = isInbound ? data.inboundDelay : data.outboundDelay;
        const dwell = isInbound ? data.dwellInbound : data.outboundDelay; // dwellOutbound로 수정 필요
        const dwellValue = isInbound ? data.dwellInbound : data.dwellOutbound; // 정확한 값 사용

        const content = `
            <div class="truck-tooltip">
                <h4>${data.name || 'Unknown'}</h4>
                <div>
                    <strong>Truck Movement</strong>
                    <p class="${delay >= 0 ? 'truck-positive' : 'truck-negative'}">
                        ${delay >= 0 ? '↑' : '↓'} ${format(delay)}%
                        <span class="truck-normal-text">${delay >= 0 ? 'above' : 'below'} 2-week avg</span>
                    </p>
                </div>
                <div>
                    <strong>Dwell Time</strong>
                    <p class="${dwellValue >= 0 ? 'truck-positive' : 'truck-negative'}">
                        ${dwellValue >= 0 ? '↑' : '↓'} ${format(dwellValue)}%
                        <span class="truck-normal-text">${dwellValue >= 0 ? 'above' : 'below'} 2-week avg</span>
                    </p>
                </div>
            </div>
        `;

        // 툴팁 위치를 인자로 받은 latlng (주의 중심)으로 설정
        L.popup({
            className: 'truck-tooltip-container',
            maxWidth: 300,
            autoClose: false,
            closeButton: false,
            closeOnClick: false,
            // 툴팁이 중앙에 잘 보이도록 offset 조정 (필요시 조절)
            offset: L.point(0, -10)
        })
        .setLatLng(latlng) // 툴팁 위치를 주의 중심으로 설정
        .setContent(content)
        .openOn(this.map);
    }

    zoomToState(feature) {
        const bounds = L.geoJSON(feature).getBounds();
        this.map.fitBounds(bounds.pad(0.3));
    }

    addControls() {
        const control = L.control({ position: 'topright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-container');
            this.controlDiv = div;
            this.renderControls();
            return div;
        };

        control.addTo(this.map);
    }

    renderControls() {
        this.controlDiv.innerHTML = `
            <div class="truck-toggle-container">
                <div class="truck-toggle-wrapper">
                    <button class="truck-toggle-btn ${this.currentMode === 'inbound' ? 'truck-active' : ''}" data-mode="inbound">INBOUND</button>
                    <button class="truck-toggle-btn ${this.currentMode === 'outbound' ? 'truck-active' : ''}" data-mode="outbound">OUTBOUND</button>
                </div>
                <button class="truck-reset-btn reset-btn">Reset View</button>
            </div>
        `;

        this.controlDiv.querySelectorAll('.truck-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentMode = btn.dataset.mode;
                this.renderControls();
                this.stateLayer.setStyle(this.getStyle.bind(this));
            });
        });

        this.controlDiv.querySelector('.truck-reset-btn').addEventListener('click', () => {
            this.map.setView([37.8, -96], 4);
            // 필터 초기화
            if (this.filterControlInstance) {
                const stateFilter = this.filterControlInstance._container.querySelector('.state-filter');
                if (stateFilter) stateFilter.value = '';
            }
        });
    }

    addFilterControl() {
        // 기존 필터 컨트롤이 있다면 제거
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }

        const control = L.control({ position: 'bottomright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'filter-control');

            // 주 목록 정렬
            const states = this.geoJsonData.features
                .map(f => ({
                    id: f.id,
                    name: f.properties.name
                }))
                .sort((a, b) => a.name.localeCompare(b.name));

            div.innerHTML = `
                <select class="state-filter">
                    <option value="">Select State</option>
                    ${states.map(state =>
                        `<option value="${state.id}">${state.name}</option>`
                    ).join('')}
                </select>
            `;

            div.querySelector('.state-filter').addEventListener('change', (e) => {
                const stateId = e.target.value;
                if (!stateId) {
                    this.map.setView([37.8, -96], 4);
                    // 모든 주 경계를 다시 렌더링 (필요하다면)
                    this.renderMap();
                    return;
                }

                const state = this.geoJsonData.features.find(f => f.id === stateId);
                if (state) {
                    const bounds = L.geoJSON(state).getBounds();
                    this.map.fitBounds(bounds.pad(0.3));
                }
            });

            return div;
        };

        control.addTo(this.map);
        this.filterControlInstance = control; // 필터 컨트롤 인스턴스 저장
    }

    // 오류 메시지 표시 함수
    showError(message) {
        // 기존 오류 메시지 컨트롤이 있다면 제거
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
        this.errorControl = errorControl; // 인스턴스 저장
    }
}

window.TruckCongestionMap = TruckCongestionMap;
