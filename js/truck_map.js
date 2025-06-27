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
        this.isZoomingToState = false; // 필터 선택으로 확대 중인지 추적하는 플래그

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
                // BUG FIX: 확대/이동 중에는 mouseover 이벤트를 무시
                if (this.isZoomingToState) return;

                const center = layer.getBounds().getCenter();
                this.showTooltip(center, data);
                layer.setStyle({
                    weight: 2,
                    color: 'white',
                    dashArray: '',
                    fillOpacity: 0.9
                });
            },
            mouseout: (e) => {
                // BUG FIX: 확대/이동 중에는 mouseout 이벤트도 무시할 수 있지만,
                // 안전하게 팝업을 닫고 스타일을 리셋하는 것이 더 나을 수 있음.
                // 단, isZoomingToState 플래그가 true일 때는 팝업이 닫히지 않도록 제어.
                if (this.isZoomingToState) return;
                this.map.closePopup();
                this.stateLayer.resetStyle(layer);
            },
            click: () => this.zoomToState(feature)
        });
    }

    showTooltip(latlng, data) {
        if (!this.initialized || !data.name) return;

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
        const fixedZoomLevel = 7; 

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
            
            const zoomControl = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
            zoomControl.innerHTML = `
                <a class="leaflet-control-zoom-in" href="#" title="Zoom in" role="button" aria-label="Zoom in">+</a>
                <a class="leaflet-control-zoom-out" href="#" title="Zoom out" role="button" aria-label="Zoom out">-</a>
            `;
            div.appendChild(zoomControl);
            
            zoomControl.querySelector('.leaflet-control-zoom-in').addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation(); this.map.zoomIn();
            });
            
            zoomControl.querySelector('.leaflet-control-zoom-out').addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation(); this.map.zoomOut();
            });

            const states = this.geoJsonData.features
                .map(f => ({ id: f.id, name: f.properties.name }))
                .sort((a, b) => a.name.localeCompare(b.name));

            const filterDropdownHtml = `
                <select class="state-filter">
                    <option value="">Select State</option>
                    ${states.map(state => `<option value="${state.id}">${state.name}</option>`).join('')}
                </select>
            `;
            div.insertAdjacentHTML('beforeend', filterDropdownHtml);

            const resetButtonHtml = `<button class="truck-reset-btn reset-btn">Reset View</button>`;
            div.insertAdjacentHTML('beforeend', resetButtonHtml);

            div.querySelector('.truck-reset-btn').addEventListener('click', () => {
                this.map.setView([37.8, -96], 4);
                const stateFilter = div.querySelector('.state-filter');
                if (stateFilter) stateFilter.value = '';
                this.map.closePopup();
            });

            // ======================================================================
            // BUG FIX v2: 필터 변경 이벤트 핸들러에 플래그 로직 추가
            // ======================================================================
            div.querySelector('.state-filter').addEventListener('change', (e) => {
                const stateId = e.target.value;
                this.map.closePopup();

                if (!stateId) {
                    this.map.setView([37.8, -96], 4);
                    return;
                }

                const state = this.geoJsonData.features.find(f => f.id === stateId);
                if (state) {
                    // 1. 확대/이동 시작 전 플래그를 true로 설정
                    this.isZoomingToState = true; 

                    const bounds = L.geoJSON(state).getBounds();
                    const center = bounds.getCenter();
                    const fixedZoomLevel = 7;
                    const stateData = this.metricData[stateId] || {};

                    this.map.once('moveend', () => {
                        // 3. 이동 완료 후 툴팁을 표시
                        this.showTooltip(center, stateData);
                        // 4. 모든 동작이 끝났으므로 플래그를 false로 리셋하여 마우스 이벤트를 다시 활성화
                        this.isZoomingToState = false;
                    });

                    // 2. 지도 이동 시작
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
