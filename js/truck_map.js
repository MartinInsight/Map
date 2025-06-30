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
            this.addRightControls(); // 리셋 버튼과 필터 드롭다운 (상단 우측)
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
                // 알래스카 (AK)에 대한 툴팁 위치 수동 조정
                if (stateCode === 'AK') {
                    center = L.latLng(62.0, -150.0);
                }
                // 텍사스(TX) mouseover 시 임의 위치 설정 제거

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
                this.currentOpenPopup = null; // 팝업 닫을 때 currentOpenPopup 초기화
                this.stateLayer.resetStyle(layer);
            },
            click: (e) => {
                const clickedStateId = feature.id;
                const stateData = this.metricData[clickedStateId] || {};

                // 기존 팝업 닫기
                this.map.closePopup();
                this.currentOpenPopup = null;

                // 지도의 다른 주를 클릭하면 '잠금' 상태 해제 및 스타일 리셋
                if (this.lockedStateId && this.lockedStateId !== clickedStateId) {
                    // 이전에 잠겨있던 주의 스타일을 리셋
                    this.stateLayer.eachLayer(currentLayer => {
                        if (currentLayer.feature.id === this.lockedStateId) {
                            this.stateLayer.resetStyle(currentLayer);
                        }
                    });
                    this.lockedStateId = null; // 잠금 해제
                    const filter = document.querySelector('.state-filter');
                    if (filter) filter.value = '';
                }
                
                // 클릭된 주로 확대 (maxZoom 통일)
                const bounds = L.geoJSON(feature).getBounds();
                if (clickedStateId === 'AK') {
                    // 알래스카는 고정 뷰로 이동 (툴팁 위치와 동일하게, 줌 레벨 5로 변경)
                    this.map.setView([62.0, -150.0], 4);
                } else {
                    this.map.fitBounds(bounds, {
                        paddingTopLeft: [50, 50],
                        paddingBottomRight: [50, 50],
                        maxZoom: 6 // 클릭 시에도 maxZoom 6 적용 (필터와 통일)
                    });
                }


                // 확대 후 이동이 끝나면 툴팁 표시
                this.map.once('moveend', () => {
                    setTimeout(() => { // 충분한 시간 지연
                        let center = L.geoJSON(feature).getBounds().getCenter();
                        if (clickedStateId === 'AK') {
                            center = L.latLng(62.0, -150.0); // 알래스카 툴팁 위치 조정
                        }
                        // 텍사스(TX) 클릭 시 임의 위치 설정 제거

                        // 팝업을 열기 직전, 지도의 크기 정보를 강제로 업데이트
                        this.map.invalidateSize(true); // true를 인자로 주어 애니메이션 없이 업데이트
                        this.showTooltip(center, stateData);
                    }, 200); // 200ms 지연
                });

                // 클릭 시 해당 주의 스타일 강조
                layer.setStyle({
                    weight: 2,
                    color: 'white',
                    dashArray: '',
                    fillOpacity: 0.9
                });

                // 클릭된 주를 lockedStateId로 설정
                this.lockedStateId = clickedStateId;
                // 필터 드롭다운도 업데이트
                const filter = document.querySelector('.state-filter');
                if (filter) filter.value = clickedStateId;
            }
        });
    }

    showTooltip(latlng, data) {
        if (!this.initialized || !data.name) return;

        // 기존 팝업이 있으면 닫고 새로 열기 (중복 방지)
        this.map.closePopup();
        this.currentOpenPopup = null; // 기존 참조 초기화

        let adjustedLatLng = latlng;
        // 알래스카인 경우 툴팁 위치 조정
        if (data.name === 'Alaska') {
            adjustedLatLng = L.latLng(62.0, -150.0); // 알래스카에 대한 특정 좌표
        }
        // 텍사스(TX) 툴팁 위치 임의 설정 제거


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
        .setLatLng(adjustedLatLng)
        .setContent(content);

        this.currentOpenPopup.openOn(this.map);
    }

    // zoomToState는 이제 클릭 이벤트 핸들러 내에서 직접 처리하므로 필요 없음 (제거하지는 않음)
    zoomToState(feature) {
        const bounds = L.geoJSON(feature).getBounds();
        // 이 함수는 더 이상 maxZoom을 직접 포함하지 않고, 호출하는 곳에서 maxZoom을 제어합니다.
        this.map.fitBounds(bounds, { paddingTopLeft: [50, 50], paddingBottomRight: [50, 50] });
    }

    addRightControls() {
        // 기존 컨트롤이 있다면 제거
        if (this.rightControlsInstance) {
            this.map.removeControl(this.rightControlsInstance);
        }

        const control = L.control({ position: 'topright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-group-right'); // 이 div가 모든 컨트롤을 담습니다.

            // 1. 줌 컨트롤 생성
            const zoomControl = L.DomUtil.create('div', 'leaflet-control-zoom');
            zoomControl.innerHTML = `
                <a class="leaflet-control-zoom-in" href="#" title="Zoom in">+</a>
                <a class="leaflet-control-zoom-out" href="#" title="Zoom out">-</a>
            `;
            div.appendChild(zoomControl);

            // 줌 버튼 이벤트 핸들러 (div에 직접 추가)
            L.DomEvent.on(zoomControl.querySelector('.leaflet-control-zoom-in'), 'click', (e) => {
                L.DomEvent.preventDefault(e);
                this.map.zoomIn();
            });
            L.DomEvent.on(zoomControl.querySelector('.leaflet-control-zoom-out'), 'click', (e) => {
                L.DomEvent.preventDefault(e);
                this.map.zoomOut();
            });

            // 2. 리셋 버튼
            const resetButtonHtml = `<button class="truck-reset-btn reset-btn">Reset View</button>`;
            div.insertAdjacentHTML('beforeend', resetButtonHtml);

            // 리셋 버튼 리스너
            L.DomEvent.on(div.querySelector('.truck-reset-btn'), 'click', () => {
                this.lockedStateId = null; // 잠금 해제
                this.map.setView([37.8, -96], 4);
                const stateFilter = div.querySelector('.state-filter');
                if (stateFilter) stateFilter.value = '';
                this.map.closePopup();
                this.currentOpenPopup = null; // 리셋 시 팝업 참조 초기화
                this.stateLayer.resetStyle(); // 모든 주의 스타일을 기본으로 되돌림
            });

            // 3. INBOUND/OUTBOUND 토글 버튼
            const toggleButtonsHtml = `
                <div class="map-control-container truck-toggle-map-control">
                    <button class="truck-toggle-btn ${this.currentMode === 'inbound' ? 'truck-active' : ''}" data-mode="inbound">IN</button>
                    <button class="truck-toggle-btn ${this.currentMode === 'outbound' ? 'truck-active' : ''}" data-mode="outbound">OUT</button>
                </div>
            `;
            div.insertAdjacentHTML('beforeend', toggleButtonsHtml);

            // 토글 버튼 이벤트 리스너
            div.querySelectorAll('.truck-toggle-btn').forEach(btn => {
                L.DomEvent.on(btn, 'click', () => {
                    this.currentMode = btn.dataset.mode;
                    // 토글 버튼의 활성 상태를 다시 렌더링 (div 내에서 직접 업데이트)
                    div.querySelectorAll('.truck-toggle-btn').forEach(innerBtn => {
                        innerBtn.classList.toggle('truck-active', innerBtn.dataset.mode === this.currentMode);
                    });
                    this.stateLayer.setStyle(this.getStyle.bind(this));
                    this.map.closePopup(); // 모드 변경 시 열려있는 팝업 닫기
                    this.currentOpenPopup = null;
                    if (this.lockedStateId) { // 잠긴 주가 있다면 해당 주 팝업 다시 띄우기
                        const lockedFeature = this.geoJsonData.features.find(f => f.id === this.lockedStateId);
                        if (lockedFeature) {
                            let center = L.geoJSON(lockedFeature).getBounds().getCenter();
                            const stateData = this.metricData[this.lockedStateId] || {}; // stateData를 올바르게 가져옴
                            // 알래스카인 경우 툴팁 위치 조정
                            if (this.lockedStateId === 'AK') {
                                center = L.latLng(62.0, -150.0);
                            }
                            // 텍사스(TX) 임의 위치 설정 제거

                            this.map.invalidateSize(true); // invalidateSize 추가
                            this.showTooltip(center, stateData);
                        }
                    }
                });
            });

            // 4. 필터 드롭다운
            const states = this.geoJsonData.features
                .map(f => ({ id: f.id, name: f.properties.name }))
                .sort((a, b) => a.name.localeCompare(b.name));

            const filterDropdownHtml = `<select class="state-filter"><option value="">Select State</option>${states.map(state => `<option value="${state.id}">${state.name}</option>`).join('')}</select>`;
            div.insertAdjacentHTML('beforeend', filterDropdownHtml);

            // 필터 변경 리스너
            L.DomEvent.on(div.querySelector('.state-filter'), 'change', (e) => {
                const stateId = e.target.value;
                this.map.closePopup();
                this.currentOpenPopup = null; // 필터 변경 시 팝업 참조 초기화

                // 이전에 잠겨있던 주의 스타일을 리셋 (필터가 변경될 때마다)
                if (this.lockedStateId) {
                    this.stateLayer.eachLayer(currentLayer => {
                        if (currentLayer.feature.id === this.lockedStateId) {
                            this.stateLayer.resetStyle(currentLayer);
                        }
                    });
                }

                if (!stateId) { // 'Select State' 선택 시
                    this.lockedStateId = null; // 잠금 해제
                    this.map.setView([37.8, -96], 4);
                    this.stateLayer.resetStyle(); // 모든 주의 스타일을 기본으로 되돌림
                    return;
                }

                const state = this.geoJsonData.features.find(f => f.id === stateId);
                if (state) {
                    this.isZoomingToState = true;
                    this.lockedStateId = stateId;

                    const bounds = L.geoJSON(state).getBounds();
                    let center = bounds.getCenter();
                    const stateData = this.metricData[stateId] || {};

                    // 알래스카인 경우 툴팁 위치 조정 및 고정된 뷰로 이동 (툴팁 위치와 동일하게, 줌 레벨 5로 변경)
                    if (stateId === 'AK') {
                        center = L.latLng(62.0, -150.0);
                        this.map.setView([62.0, -150.0], 5); // 알래스카 화면 이동 중심 좌표 통일, 줌 레벨 5
                    } else {
                        // setView 대신 fitBounds를 사용하여 줌 레벨을 더 유연하게 조정
                        // 알래스카를 제외한 모든 주에 maxZoom을 적용하여 줌 레벨을 제한합니다.
                        this.map.fitBounds(bounds, {
                            paddingTopLeft: [50, 50],
                            paddingBottomRight: [50, 50],
                            maxZoom: 6 // maxZoom 6 통일
                        });
                    }

                    this.map.once('moveend', () => {
                        // Leaflet이 지도를 완전히 렌더링할 시간을 벌기 위해 setTimeout을 사용합니다.
                        setTimeout(() => {
                            // 텍사스(TX) 임의 위치 설정 제거

                            // 팝업을 열기 직전, 지도의 크기 정보를 강제로 업데이트
                            this.map.invalidateSize(true); // invalidateSize 추가
                            this.showTooltip(center, stateData);

                            // 선택된 주의 스타일을 강조
                            this.stateLayer.eachLayer(layer => {
                                if (layer.feature.id === stateId) {
                                    layer.setStyle({
                                        weight: 2,
                                        color: 'white',
                                        dashArray: '',
                                        fillOpacity: 0.9
                                    });
                                } else {
                                    this.stateLayer.resetStyle(layer); // 다른 주는 기본 스타일로 되돌림
                                }
                            });
                            this.isZoomingToState = false;
                        }, 100); // 100ms 지연 (필요에 따라 조절)
                    });
                }
            });

            // 클릭/스크롤 전파 방지
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.rightControlsInstance = control; // L.control 인스턴스를 저장
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
