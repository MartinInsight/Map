class TruckCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId, {
            zoomControl: false // 기본 줌 컨트롤 비활성화
        }).setView([37.8, -96], 4);
        this.stateLayer = null;
        this.currentMode = 'inbound';
        this.metricData = null;
        this.geoJsonData = null;
        this.initialized = false;
        this.controlDiv = null;
        this.errorControl = null;

        // 지도 타일 레이어를 CartoDB Light All로 변경하여 영어 지명 통일
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 18,
            minZoom: 3
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

        this.init();
    }

    async init() {
        try {
            // us-truck.json 파일 경로 수정 (프로젝트 구조에 맞게)
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
            this.addToggleControls(); // INBOUND/OUTBOUND 토글 버튼 (상단 중앙)
            this.addRightControls();   // 리셋 버튼과 필터 드롭다운 (상단 우측)
            this.initialized = true;
        } catch (err) {
            console.error("Initialization failed:", err);
            this.showError("Failed to load truck data. Please try again later.");
        }
    }

    async fetchSheetData() {
        try {
            // data 폴더에 있는 us-truck.json을 fetch하도록 경로 수정
            const res = await fetch('data/us-truck.json');
            if (!res.ok) throw new Error("Truck data fetch error");
            return await res.json();
        } catch (err) {
            console.warn("Truck data fetch failed, using fallback data.");
            return {
                'AL': { name: 'Alabama', inboundDelay: 0, inboundColor: 0, outboundDelay: 0, outboundColor: 0, dwellInbound: 0, dwellOutbound: 0 },
                'TN': { name: 'Tennessee', inboundDelay: 0, inboundColor: 0, outboundDelay: 0, outboundColor: 0, dwellInbound: 0, dwellOutbound: 0 }
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
            color: 'white', // 기본 테두리 색상은 흰색
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
        return colors[String(value)] || '#cccccc';
    }

    bindEvents(feature, layer) {
        const stateCode = feature.id;
        const data = this.metricData[stateCode] || {};

        layer.on({
            mouseover: (e) => {
                const center = layer.getBounds().getCenter();
                this.showTooltip(center, data);
                layer.setStyle({
                    weight: 2, // 호버 시 테두리 두께를 2로 변경
                    color: 'white', // 호버 시에도 테두리 색상은 흰색 유지
                    dashArray: '',
                    fillOpacity: 0.9
                });
            },
            mouseout: (e) => {
                this.map.closePopup();
                this.stateLayer.resetStyle(layer); // 원래 스타일로 복원 (weight: 1, color: 'white')
            },
            click: () => this.zoomToState(feature)
        });
    }

    showTooltip(latlng, data) {
        if (!this.initialized || !data.name) return; // 데이터가 없으면 툴팁 표시 안 함

        const format = (v) => isNaN(Number(v)) ? '0.00' : Math.abs(Number(v)).toFixed(2);
        const isInbound = this.currentMode === 'inbound';
        const delay = isInbound ? data.inboundDelay : data.outboundDelay;
        const dwellValue = isInbound ? data.dwellInbound : data.dwellOutbound;

        const content = `
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
        `;

        L.popup({
            className: 'truck-tooltip-container',
            maxWidth: 300,
            autoClose: false,
            closeButton: false,
            closeOnClick: false,
            offset: L.point(0, -10)
        })
        .setLatLng(latlng)
        .setContent(content)
        .openOn(this.map);
    }

    zoomToState(feature) {
        const bounds = L.geoJSON(feature).getBounds();
        const center = bounds.getCenter();
        const fixedZoomLevel = 7; // 모든 주에 대해 동일한 줌 레벨을 적용합니다.

        this.map.setView(center, fixedZoomLevel);
    }

    addToggleControls() {
        const centeredToggleDiv = L.DomUtil.create('div', 'map-control-container truck-toggle-map-control');
        this.map.getContainer().appendChild(centeredToggleDiv); 

        this.controlDiv = centeredToggleDiv;
        this.renderToggleButtons();

        L.DomEvent.disableClickPropagation(centeredToggleDiv);
        L.DomEvent.disableScrollPropagation(centeredToggleDiv);
    }

    renderToggleButtons() {
        this.controlDiv.innerHTML = `
            <button class="truck-toggle-btn ${this.currentMode === 'inbound' ? 'truck-active' : ''}" data-mode="inbound">INBOUND</button>
            <button class="truck-toggle-btn ${this.currentMode === 'outbound' ? 'truck-active' : ''}" data-mode="outbound">OUTBOUND</button>
        `;

        this.controlDiv.querySelectorAll('.truck-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentMode = btn.dataset.mode;
                this.renderToggleButtons();
                this.stateLayer.setStyle(this.getStyle.bind(this));
            });
        });
    }

    addRightControls() {
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }
        
        const control = L.control({ position: 'topright' });
        
        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-group-right');
            
            // 커스텀 줌 컨트롤 추가
            const zoomControl = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
            zoomControl.innerHTML = `
                <a class="leaflet-control-zoom-in" href="#" title="Zoom in" role="button" aria-label="Zoom in">+</a>
                <a class="leaflet-control-zoom-out" href="#" title="Zoom out" role="button" aria-label="Zoom out">-</a>
            `;
            div.appendChild(zoomControl);
            
            // 줌 버튼 이벤트 핸들러
            zoomControl.querySelector('.leaflet-control-zoom-in').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.map.zoomIn();
            });
            
            zoomControl.querySelector('.leaflet-control-zoom-out').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.map.zoomOut();
            });

            // 주 선택 필터 드롭다운 추가
            const states = this.geoJsonData.features
                .map(f => ({
                    id: f.id,
                    name: f.properties.name
                }))
                .sort((a, b) => a.name.localeCompare(b.name));

            const filterDropdownHtml = `
                <select class="state-filter">
                    <option value="">Select State</option>
                    ${states.map(state =>
                        `<option value="${state.id}">${state.name}</option>`
                    ).join('')}
                </select>
            `;
            div.insertAdjacentHTML('beforeend', filterDropdownHtml);

            // 리셋 버튼 추가
            const resetButtonHtml = `
                <button class="truck-reset-btn reset-btn">Reset View</button>
            `;
            div.insertAdjacentHTML('beforeend', resetButtonHtml);

            // 이벤트 리스너 추가
            div.querySelector('.truck-reset-btn').addEventListener('click', () => {
                this.map.setView([37.8, -96], 4);
                const stateFilter = div.querySelector('.state-filter');
                if (stateFilter) stateFilter.value = '';
                this.map.closePopup(); // 리셋 시 툴팁 닫기
            });

            // ======================================================================
            // BUG FIX: 필터 변경 이벤트 핸들러 수정
            // ======================================================================
            div.querySelector('.state-filter').addEventListener('change', (e) => {
                const stateId = e.target.value;

                // 1. 어떤 동작이든 시작하기 전에 열려있는 팝업을 먼저 닫습니다.
                this.map.closePopup();

                if (!stateId) {
                    // "Select State"를 선택하면 기본 뷰로 리셋합니다.
                    this.map.setView([37.8, -96], 4);
                    return;
                }

                const state = this.geoJsonData.features.find(f => f.id === stateId);
                if (state) {
                    const bounds = L.geoJSON(state).getBounds();
                    const center = bounds.getCenter();
                    const fixedZoomLevel = 7;
                    const stateData = this.metricData[stateId] || {};

                    // 2. 지도 이동/줌 애니메이션이 끝난 후 'moveend' 이벤트를 한 번만 수신합니다.
                    this.map.once('moveend', () => {
                        // 3. 애니메이션이 끝난 후, 해당 주의 툴팁을 정확한 위치에 표시합니다.
                        this.showTooltip(center, stateData);
                    });

                    // 4. 지도 이동을 시작합니다.
                    this.map.setView(center, fixedZoomLevel);
                }
            });

            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.filterControlInstance = control;
            return div;
        };
        
        control.addTo(this.map);
    }
    
    showError(message) {
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

window.TruckCongestionMap = TruckCongestionMap;
