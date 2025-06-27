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
        this.lockedStateId = null; // 필터로 선택되어 '잠긴' 주의 ID를 추적하는 플래그
        this.currentOpenPopup = null; // 현재 열려있는 팝업에 대한 참조 추가

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

        // 팝업이 닫힐 때 currentOpenPopup 참조를 초기화합니다.
        this.map.on('popupclose', (e) => {
            if (this.currentOpenPopup && e.popup === this.currentOpenPopup) {
                this.currentOpenPopup = null;
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
            this.addRightControls();    // 리셋 버튼과 필터 드롭다운 (상단 우측)
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
                // 확대/이동 중이거나 특정 주가 '잠금' 상태일 때는 hover 무시
                if (this.isZoomingToState || this.lockedStateId) return;

                let center = layer.getBounds().getCenter();
                // 알래스카 (AK)에 대한 툴팁 위치 수동 조정 (이전 요청의 반영)
                if (stateCode === 'AK') {
                    // 이 좌표는 지도를 보면서 가장 적절한 위치로 조정해야 합니다.
                    center = L.latLng(62.0, -150.0); 
                }

                this.showTooltip(center, data);
                layer.setStyle({
                    weight: 2,
                    color: 'white',
                    dashArray: '',
                    fillOpacity: 0.9
                });
            },
            mouseout: (e) => {
                // 특정 주가 '잠금' 상태일 때는 mouseout 무시
                if (this.lockedStateId) return;

                // 깜빡임 방지 로직: 마우스가 팝업 안으로 이동하면 닫지 않음
                if (this.currentOpenPopup) {
                    const toElement = e.originalEvent.relatedTarget;
                    // 마우스가 팝업의 DOM 요소 내부에 있는지 확인
                    if (this.currentOpenPopup.getElement() && this.currentOpenPopup.getElement().contains(toElement)) {
                        return; // 마우스가 팝업 내부에 있으므로 리턴
                    }
                }

                this.map.closePopup();
                this.stateLayer.resetStyle(layer);
            },
            click: (e) => {
                // 지도의 다른 주를 클릭하면 '잠금' 상태 해제
                if (this.lockedStateId) {
                    this.lockedStateId = null;
                    const filter = document.querySelector('.state-filter');
                    if (filter) filter.value = '';
                }
                this.zoomToState(feature);
            }
        });
    }

    showTooltip(latlng, data) {
        if (!this.initialized || !data.name) return;

        // 기존 팝업이 있으면 닫고 새로 열기 (중복 방지)
        this.map.closePopup();
        this.currentOpenPopup = null; // 기존 참조 초기화

        const format = (v) => isNaN(Number(v)) ? '0.00' : Math.abs(Number(v)).toFixed(2);
        const isInbound = this.currentMode === 'inbound';
        const delay = isInbound ? data.inboundDelay : data.outboundDelay;
        const dwellValue = isInbound ? data.dwellInbound : data.outboundDwell; // 'outboundDwell' 사용

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

        // 팝업을 생성하고 참조를 저장합니다.
        this.currentOpenPopup = L.popup({
            className: 'truck-tooltip-container',
            maxWidth: 300,
            autoClose: false,
            closeButton: false,
            closeOnClick: false,
            offset: L.point(0, -10)
        })
        .setLatLng(latlng)
        .setContent(content);

        this.currentOpenPopup.openOn(this.map);
    }

    zoomToState(feature) {
        const bounds = L.geoJSON(feature).getBounds();
        this.map.fitBounds(bounds, { paddingTopLeft: [50, 50], paddingBottomRight: [50, 50] });
    }

    addToggleControls() {
        const centeredToggleDiv = L.DomUtil.create('div', 'map-control-container truck-toggle-map-control');
        this.map.getContainer().appendChild(centeredToggleDiv);

        this.controlDiv = centeredToggleDiv;
        this.renderToggleButtons();

        // 탭 메뉴의 실제 높이를 가져와 토글 컨트롤의 top 위치를 설정
        const tabContainer = document.querySelector('.transport-tab-container');
        if (tabContainer) {
            // 탭 메뉴 높이 + 10px 여백
            const tabHeight = tabContainer.offsetHeight; 
            centeredToggleDiv.style.top = `${tabHeight + 10}px`;
        } else {
            // 탭 메뉴를 찾지 못할 경우 기본값 설정 (CSS의 고정값과 일치)
            centeredToggleDiv.style.top = '50px'; 
        }

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
            
            // 줌 컨트롤 생성
            const zoomControl = L.DomUtil.create('div', 'leaflet-control-zoom');
            zoomControl.innerHTML = `
                <a class="leaflet-control-zoom-in" href="#" title="Zoom in">+</a>
                <a class="leaflet-control-zoom-out" href="#" title="Zoom out">-</a>
            `;
            div.appendChild(zoomControl);
            
            // 줌 버튼 이벤트 핸들러
            zoomControl.querySelector('.leaflet-control-zoom-in').addEventListener('click', (e) => { e.preventDefault(); this.map.zoomIn(); });
            zoomControl.querySelector('.leaflet-control-zoom-out').addEventListener('click', (e) => { e.preventDefault(); this.map.zoomOut(); });

            const states = this.geoJsonData.features
                .map(f => ({ id: f.id, name: f.properties.name }))
                .sort((a, b) => a.name.localeCompare(b.name));

            const filterDropdownHtml = `<select class="state-filter"><option value="">Select State</option>${states.map(state => `<option value="${state.id}">${state.name}</option>`).join('')}</select>`;
            const resetButtonHtml = `<button class="truck-reset-btn reset-btn">Reset View</button>`;

            // 순서 변경: 리셋 버튼 먼저 추가, 그 다음에 필터 드롭다운 추가
            div.insertAdjacentHTML('beforeend', resetButtonHtml);
            div.insertAdjacentHTML('beforeend', filterDropdownHtml);

            // 리셋 버튼 리스너
            div.querySelector('.truck-reset-btn').addEventListener('click', () => {
                this.lockedStateId = null; // 잠금 해제
                this.map.setView([37.8, -96], 4);
                const stateFilter = div.querySelector('.state-filter');
                if (stateFilter) stateFilter.value = '';
                this.map.closePopup();
                this.currentOpenPopup = null; // 리셋 시 팝업 참조 초기화
            });

            // 필터 변경 리스너
            div.querySelector('.state-filter').addEventListener('change', (e) => {
                const stateId = e.target.value;
                this.map.closePopup();
                this.currentOpenPopup = null; // 필터 변경 시 팝업 참조 초기화

                if (!stateId) { // 'Select State' 선택 시
                    this.lockedStateId = null; // 잠금 해제
                    this.map.setView([37.8, -96], 4);
                    return;
                }

                const state = this.geoJsonData.features.find(f => f.id === stateId);
                if (state) {
                    this.isZoomingToState = true;
                    this.lockedStateId = stateId; // 선택한 주를 '잠금'

                    const bounds = L.geoJSON(state).getBounds();
                    const center = bounds.getCenter();
                    const stateData = this.metricData[stateId] || {};

                    this.map.once('moveend', () => {
                        this.showTooltip(center, stateData);
                        this.isZoomingToState = false;
                    });
                    
                    // setView 대신 fitBounds를 사용하여 줌 레벨을 더 유연하게 조정
                    this.map.fitBounds(bounds, { paddingTopLeft: [50, 50], paddingBottomRight: [50, 50] });
                }
            });

            // 클릭/스크롤 전파 방지
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.filterControlInstance = control;
            return div;
        };
        
        control.addTo(this.map);

        // 탭 메뉴의 실제 높이를 가져와 우측 컨트롤의 top 위치를 설정
        const tabContainer = document.querySelector('.transport-tab-container');
        const leafletRightControl = document.querySelector('.leaflet-top.leaflet-right');
        if (tabContainer && leafletRightControl) {
            // 탭 메뉴 높이 + 10px 여백
            const tabHeight = tabContainer.offsetHeight; 
            leafletRightControl.style.top = `${tabHeight + 10}px`;
        } else if (leafletRightControl) {
            // 탭 메뉴를 찾지 못할 경우 기본값 설정 (CSS의 고정값과 일치)
            leafletRightControl.style.top = '50px'; 
        }
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
