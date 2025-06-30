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
        this.errorControl = null;
        this.isZoomingToState = false; // 필터 선택으로 확대 중인지 추적하는 플래그
        this.lockedStateId = null; // 필터로 선택되어 '잠긴' 주의 ID를 추적하는 플래그
        this.currentOpenPopup = null; // 현재 열려있는 팝업에 대한 참조 추가
        this.rightControlsInstance = null; // 통합된 우측 컨트롤 인스턴스

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

        this.map.on('popupclose', (e) => {
            if (this.currentOpenPopup && e.popup === this.currentOpenPopup) {
                this.currentOpenPopup = null;
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
            this.addRightControls();
            this.initialized = true;
        } catch (err) {
            console.error("Initialization failed:", err);
            this.showError("Failed to load truck data. Please try again later.");
        }
    }

    async fetchSheetData() {
        try {
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
            weight: (this.lockedStateId === stateCode) ? 2 : 1, // 선택된 주는 테두리 두껍게
            opacity: 1,
            color: (this.lockedStateId === stateCode) ? 'white' : 'white', // 선택된 주는 흰색 테두리
            fillOpacity: (this.lockedStateId === stateCode) ? 0.9 : 0.7 // 선택된 주는 더 불투명하게
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
                // 확대 중이거나, 주가 잠겨있으면 mouseover 툴팁은 뜨지 않도록 (기존 로직 유지)
                if (this.isZoomingToState || this.lockedStateId) return;

                let center = layer.getBounds().getCenter();
                this.showTooltip(center, data);
                
                layer.setStyle({
                    weight: 2,
                    color: 'white',
                    dashArray: '',
                    fillOpacity: 0.9
                });
            },
            mouseout: (e) => {
                // 주가 잠겨있으면 mouseout 시에도 스타일을 초기화하지 않음 (lockedStateId가 있다면 툴팁도 닫지 않음)
                if (this.lockedStateId) return;

                // 툴팁 위로 마우스가 이동하면 툴팁이 닫히지 않도록 처리 (기존 로직 유지)
                if (this.currentOpenPopup) {
                    const toElement = e.originalEvent.relatedTarget;
                    if (this.currentOpenPopup.getElement() && this.currentOpenPopup.getElement().contains(toElement)) {
                        return;
                    }
                }

                this.map.closePopup();
                this.currentOpenPopup = null; // 툴팁이 닫혔으니 참조를 null로 설정
                this.stateLayer.resetStyle(layer); // 해당 레이어만 스타일 리셋
            },
            click: (e) => {
                const clickedStateId = feature.id;
                const stateData = this.metricData[clickedStateId] || {};

                // 기존 팝업 닫기 (새로운 팝업이 열릴 것이므로)
                this.map.closePopup();
                this.currentOpenPopup = null;

                // 현재 클릭된 주가 이미 잠겨있는 주라면, 잠금 해제 및 초기화
                if (this.lockedStateId === clickedStateId) {
                    this.lockedStateId = null;
                    const filter = document.querySelector('.state-filter');
                    if (filter) filter.value = ''; // 필터 드롭다운 초기화
                    this.map.setView([37.8, -96], 4); // 전체 맵 뷰로 돌아감
                    this.stateLayer.resetStyle(); // 모든 주 스타일 리셋
                    return; // 초기화 후 바로 종료
                }

                // 다른 주를 클릭했거나, 아무 주도 잠겨있지 않은 상태라면
                this.lockedStateId = clickedStateId; // 클릭된 주를 잠금
                const filter = document.querySelector('.state-filter');
                if (filter) filter.value = clickedStateId; // 필터 드롭다운도 업데이트
                
                // 클릭된 주로 확대 및 툴팁 표시
                // 알래스카 (AK)인 경우 특정 좌표로 이동
                if (clickedStateId === 'AK' || feature.properties.name === 'Alaska') {
                    this.map.setView([62.0, -150.0], 4); // 알래스카 툴팁 위치로 이동
                    this.map.once('moveend', () => {
                        this.showTooltip(L.latLng(62.0, -150.0), stateData); // 툴팁도 조정된 좌표로
                        this.stateLayer.setStyle(this.getStyle.bind(this)); // 스타일 업데이트
                    });
                } else {
                    // 다른 주는 해당 주의 바운드에 맞게 확대
                    const bounds = L.geoJSON(feature).getBounds();
                    this.map.fitBounds(bounds, { paddingTopLeft: [50, 50], paddingBottomRight: [50, 50] });
                    
                    const center = bounds.getCenter();
                    this.map.once('moveend', () => {
                        this.showTooltip(center, stateData);
                        this.stateLayer.setStyle(this.getStyle.bind(this)); // 스타일 업데이트
                    });
                }
            }
        });
    }

    showTooltip(latlng, data) {
        if (!this.initialized || !data.name) return;

        // 이미 열려있는 팝업이 있다면 닫기 (새로운 팝업을 열기 위함)
        if (this.currentOpenPopup) {
            this.map.closePopup();
            this.currentOpenPopup = null;
        }

        let adjustedLatLng = latlng;
        // 알래스카인 경우 툴팁 위치 조정 (기존 로직 유지)
        if (data.name === 'Alaska' || data.name === 'AK') {
            adjustedLatLng = L.latLng(62.0, -150.0); // 알래스카에 대한 특정 좌표
        }


        const format = (v) => isNaN(Number(v)) ? '0.00' : Math.abs(Number(v)).toFixed(2);
        const isInbound = this.currentMode === 'inbound';
        const delay = isInbound ? data.inboundDelay : data.outboundDelay;
        const dwellValue = isInbound ? data.dwellInbound : data.outboundDwell;

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

        this.currentOpenPopup = L.popup({
            className: 'truck-tooltip-container',
            maxWidth: 300,
            autoClose: false,
            closeButton: false,
            closeOnClick: false,
            offset: L.point(0, -10)
        })
        .setLatLng(adjustedLatLng) // 조정된 latlng 사용
        .setContent(content);

        this.currentOpenPopup.openOn(this.map);
    }

    zoomToState(feature) {
        // 이 함수는 bindEvents와 addRightControls에서 이미 알래스카 특수 처리를 포함하여 호출됩니다.
        // 여기서는 일반적인 바운드 확대 로직만 담당하도록 유지합니다.
        const bounds = L.geoJSON(feature).getBounds();
        this.map.fitBounds(bounds, { paddingTopLeft: [50, 50], paddingBottomRight: [50, 50] });
    }

    addRightControls() {
        if (this.rightControlsInstance) {
            this.map.removeControl(this.rightControlsInstance);
        }

        const control = L.control({ position: 'topright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-group-right');

            const zoomControl = L.DomUtil.create('div', 'leaflet-control-zoom');
            zoomControl.innerHTML = `
                <a class="leaflet-control-zoom-in" href="#" title="Zoom in">+</a>
                <a class="leaflet-control-zoom-out" href="#" title="Zoom out">-</a>
            `;
            div.appendChild(zoomControl);

            L.DomEvent.on(zoomControl.querySelector('.leaflet-control-zoom-in'), 'click', (e) => {
                L.DomEvent.preventDefault(e);
                this.map.zoomIn();
            });
            L.DomEvent.on(zoomControl.querySelector('.leaflet-control-zoom-out'), 'click', (e) => {
                L.DomEvent.preventDefault(e);
                this.map.zoomOut();
            });

            const resetButtonHtml = `<button class="truck-reset-btn reset-btn">Reset View</button>`;
            div.insertAdjacentHTML('beforeend', resetButtonHtml);

            L.DomEvent.on(div.querySelector('.truck-reset-btn'), 'click', () => {
                this.lockedStateId = null;
                this.map.setView([37.8, -96], 4);
                const stateFilter = div.querySelector('.state-filter');
                if (stateFilter) stateFilter.value = '';
                this.map.closePopup();
                this.currentOpenPopup = null;
                this.stateLayer.resetStyle(); // 모든 주 스타일 리셋
            });

            const toggleButtonsHtml = `
                <div class="map-control-container truck-toggle-map-control">
                    <button class="truck-toggle-btn ${this.currentMode === 'inbound' ? 'truck-active' : ''}" data-mode="inbound">IN</button>
                    <button class="truck-toggle-btn ${this.currentMode === 'outbound' ? 'truck-active' : ''}" data-mode="outbound">OUT</button>
                </div>
            `;
            div.insertAdjacentHTML('beforeend', toggleButtonsHtml);

            div.querySelectorAll('.truck-toggle-btn').forEach(btn => {
                L.DomEvent.on(btn, 'click', () => {
                    this.currentMode = btn.dataset.mode;
                    div.querySelectorAll('.truck-toggle-btn').forEach(innerBtn => {
                        innerBtn.classList.toggle('truck-active', innerBtn.dataset.mode === this.currentMode);
                    });
                    // 모드 변경 시에는 lockedStateId에 따라 스타일만 업데이트 (showTooltip은 아래에서 다시 호출)
                    this.stateLayer.setStyle(this.getStyle.bind(this));
                    this.map.closePopup();
                    this.currentOpenPopup = null;
                    if (this.lockedStateId) {
                        const lockedFeature = this.geoJsonData.features.find(f => f.id === this.lockedStateId);
                        if (lockedFeature) {
                            // 모드 변경 시에도 알래스카 위치를 고려하여 툴팁 다시 표시
                            // showTooltip 함수 자체에서 알래스카 위치를 조정하므로, 여기서 특별히 할 필요는 없음.
                            let center;
                            if (lockedFeature.id === 'AK' || lockedFeature.properties.name === 'Alaska') {
                                center = L.latLng(62.0, -150.0);
                            } else {
                                center = L.geoJSON(lockedFeature).getBounds().getCenter();
                            }
                            const stateData = this.metricData[this.lockedStateId] || {};
                            this.showTooltip(center, stateData);
                        }
                    }
                });
            });

            const states = this.geoJsonData.features
                .map(f => ({ id: f.id, name: f.properties.name }))
                .sort((a, b) => a.name.localeCompare(b.name));

            const filterDropdownHtml = `<select class="state-filter"><option value="">Select State</option>${states.map(state => `<option value="${state.id}">${state.name}</option>`).join('')}</select>`;
            div.insertAdjacentHTML('beforeend', filterDropdownHtml);

            L.DomEvent.on(div.querySelector('.state-filter'), 'change', (e) => {
                const stateId = e.target.value;
                const state = this.geoJsonData.features.find(f => f.id === stateId);
                const stateData = this.metricData[stateId] || {};

                this.map.closePopup();
                this.currentOpenPopup = null;

                // 'Select State' 선택 시 초기화
                if (!stateId) {
                    this.lockedStateId = null;
                    this.map.setView([37.8, -96], 4);
                    this.stateLayer.resetStyle();
                    return;
                }

                if (state) {
                    this.isZoomingToState = true;
                    this.lockedStateId = stateId;

                    // 알래스카 (AK)인 경우 특정 좌표로 이동하고 툴팁 표시
                    if (state.id === 'AK' || state.properties.name === 'Alaska') {
                        this.map.setView([62.0, -150.0], 4); // 알래스카 툴팁 위치로 이동
                        this.map.once('moveend', () => {
                            this.showTooltip(L.latLng(62.0, -150.0), stateData);
                            this.isZoomingToState = false;
                            this.stateLayer.setStyle(this.getStyle.bind(this)); // 스타일 업데이트
                        });
                    } else {
                        // 다른 주는 기존 로직 유지 (바운드에 맞게 확대하고 툴팁 표시)
                        const bounds = L.geoJSON(state).getBounds();
                        this.map.fitBounds(bounds, { paddingTopLeft: [50, 50], paddingBottomRight: [50, 50] });

                        this.map.once('moveend', () => {
                            const center = bounds.getCenter();
                            this.showTooltip(center, stateData);
                            this.isZoomingToState = false;
                            this.stateLayer.setStyle(this.getStyle.bind(this)); // 스타일 업데이트
                        });
                    }
                }
            });

            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.rightControlsInstance = control;
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
