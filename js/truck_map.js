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
        // this.isZoomingToState = false; // 이 플래그는 lockedStateId로 대체 가능하여 필요성이 줄어듭니다.
        this.lockedStateId = null; // 필터로 선택되어 '잠긴' 주의 ID를 추적하는 플래그 (필터에 의해서만 잠김)
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
        // 그리고 lockedStateId가 없는 일반적인 팝업 (클릭 또는 마우스오버로 열린 팝업)이라면 스타일을 리셋합니다.
        this.map.on('popupclose', (e) => {
            if (this.currentOpenPopup && e.popup === this.currentOpenPopup) {
                this.currentOpenPopup = null;
            }
            // lockedStateId가 현재 설정되어 있지 않고, 팝업이 닫히는 레이어가 있는 경우에만 스타일 리셋
            // 필터로 잠긴 팝업은 수동으로 닫히고 스타일 리셋되므로 여기서는 제외
            if (!this.lockedStateId && e.popup && e.popup._source) {
                 this.stateLayer.resetStyle(e.popup._source);
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

        // lockedStateId가 설정되어 있고 현재 주가 lockedStateId와 일치하면 강조 스타일 적용
        const isLocked = this.lockedStateId === stateCode;

        return {
            fillColor: this.getColor(colorValue),
            weight: isLocked ? 2 : 1, // 잠긴 주는 두껍게
            opacity: 1,
            color: isLocked ? '#FFF' : 'white', // 잠긴 주는 흰색 테두리 유지, 나머지 흰색
            fillOpacity: isLocked ? 0.9 : 0.7 // 잠긴 주는 더 불투명하게
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
                // lockedStateId가 설정되어 있으면 (필터로 특정 주가 선택된 상태이면)
                // 다른 주에 마우스를 올려도 툴팁을 띄우거나 스타일을 변경하지 않음
                if (this.lockedStateId) {
                    // 단, lockedStateId와 현재 마우스 오버된 주가 같으면 툴팁을 다시 띄울 수 있도록 허용 (필요하다면)
                    // 지금은 필터에서 띄워진 툴팁이 고정될 것이므로 이 조건도 막는 것이 맞음.
                    return;
                }

                let center = layer.getBounds().getCenter();
                // 알래스카 (AK)와 하와이 (HI)에 대한 툴팁 위치 수동 조정
                if (stateCode === 'AK') {
                    center = L.latLng(62.0, -150.0);
                } else if (stateCode === 'HI') {
                    center = L.latLng(20.7, -157.5); // 하와이 툴팁 위치 조정
                }

                // showTooltip에 layer 객체를 전달하여 popup._source를 설정할 수 있도록 합니다.
                this.showTooltip(center, data, layer);
                layer.setStyle({ // 마우스 오버 시 스타일 변경
                    weight: 2,
                    color: 'white',
                    dashArray: '',
                    fillOpacity: 0.9
                });
            },
            mouseout: (e) => {
                // lockedStateId가 설정되어 있으면 툴팁 닫기/스타일 초기화 방지
                if (this.lockedStateId) return;

                // 마우스가 팝업 내부로 진입하면 닫지 않음
                if (this.currentOpenPopup) {
                    const toElement = e.originalEvent.relatedTarget;
                    if (this.currentOpenPopup.getElement() && this.currentOpenPopup.getElement().contains(toElement)) {
                        return;
                    }
                }

                this.map.closePopup();
                this.currentOpenPopup = null;
                this.stateLayer.resetStyle(layer); // 스타일 초기화
            },
            click: (e) => {
                const clickedStateId = feature.id;
                const stateData = this.metricData[clickedStateId] || {};

                this.map.closePopup(); // 현재 열린 팝업 닫기
                this.currentOpenPopup = null;

                // 이전에 필터로 잠겨있던 주가 있었다면 스타일 리셋
                if (this.lockedStateId) { // 이전에 잠긴 주가 있었다면 (필터로 잠겼을 경우)
                    this.stateLayer.eachLayer(currentLayer => {
                        if (currentLayer.feature.id === this.lockedStateId) {
                            this.stateLayer.resetStyle(currentLayer);
                        }
                    });
                    this.lockedStateId = null; // 클릭 시에는 lockedStateId를 해제
                }

                // 클릭 시에는 드롭다운 필터 값을 클릭된 주로 업데이트
                const filter = document.querySelector('.state-filter');
                if (filter) filter.value = clickedStateId;


                // 클릭된 주로 확대/이동 로직
                // this.isZoomingToState = true; // 이 플래그는 이제 lockedStateId가 더 정확한 역할을 하므로 제거합니다.

                if (clickedStateId === 'AK') {
                    this.map.setView([62.0, -150.0], 4, { animate: true, duration: 0.5 });
                } else if (clickedStateId === 'HI') {
                    this.map.setView([20.7, -157.5], 6, { animate: true, duration: 0.5 });
                } else {
                    const bounds = L.geoJSON(feature).getBounds();
                    this.map.fitBounds(bounds, {
                        paddingTopLeft: [50, 50],
                        paddingBottomRight: [50, 50],
                        maxZoom: 6,
                        animate: true,
                        duration: 0.5
                    });
                }

                this.map.once('moveend', () => {
                    this.map.invalidateSize(true);

                    let tooltipCenter = L.geoJSON(feature).getBounds().getCenter();
                    if (clickedStateId === 'AK') {
                        tooltipCenter = L.latLng(62.0, -150.0);
                    } else if (clickedStateId === 'HI') {
                        tooltipCenter = L.latLng(20.7, -157.5);
                    }

                    // 클릭 후 지연 없이 툴팁 표시 및 스타일 적용
                    // setTimeout을 굳이 사용하지 않아도 됩니다.
                    this.showTooltip(tooltipCenter, stateData, layer); // 클릭된 주 툴팁 표시
                    layer.setStyle({ // 클릭된 주 스타일 강조 (마우스오버처럼 동작)
                        weight: 2,
                        color: 'white',
                        dashArray: '',
                        fillOpacity: 0.9
                    });

                    // 클릭은 잠금 상태를 유발하지 않으므로, moveend 이후 별도의 해제 로직은 필요 없습니다.
                    // 마우스를 떼면 mouseout 이벤트에 의해 툴팁이 닫히고 스타일이 리셋될 것입니다.
                });
            }
        });
    }

    // showTooltip 함수에 layer 매개변수 추가: popup._source 설정을 위함
    showTooltip(latlng, data, layer = null) {
        if (!this.initialized || !data.name) return;

        this.map.closePopup();
        this.currentOpenPopup = null;

        let adjustedLatLng = latlng;
        // 알래스카와 하와이 툴팁 위치 조정 (기존 로직 유지)
        if (data.name === 'Alaska') {
            adjustedLatLng = L.latLng(62.0, -150.0);
        } else if (data.name === 'Hawaii') {
            adjustedLatLng = L.latLng(20.7, -157.5);
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
            autoClose: false, // 마우스 아웃으로 닫히도록 수동 제어
            closeButton: false,
            closeOnClick: false, // 클릭으로 닫히지 않도록
            offset: L.point(0, -10)
        })
        .setLatLng(adjustedLatLng)
        .setContent(content);

        // 팝업의 _source를 설정하여 popupclose 이벤트에서 스타일 리셋을 할 수 있도록 합니다.
        // 이것은 Leaflet의 비공개 속성이지만, 일반적으로 팝업이 어떤 레이어에서 왔는지 참조할 때 사용됩니다.
        if (layer) {
             this.currentOpenPopup._source = layer;
        }

        this.currentOpenPopup.openOn(this.map);
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
                this.lockedStateId = null; // 리셋 버튼 클릭 시 잠금 해제
                this.map.setView([37.8, -96], 4);
                const stateFilter = div.querySelector('.state-filter');
                if (stateFilter) stateFilter.value = '';
                this.map.closePopup();
                this.currentOpenPopup = null;
                this.stateLayer.resetStyle(); // 모든 주 스타일 초기화
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
                    this.stateLayer.setStyle(this.getStyle.bind(this)); // 스타일 업데이트
                    this.map.closePopup();
                    this.currentOpenPopup = null;
                    // 토글 버튼 클릭 시 lockedStateId가 설정되어 있다면 해당 툴팁 다시 표시
                    if (this.lockedStateId) {
                        const lockedFeature = this.geoJsonData.features.find(f => f.id === this.lockedStateId);
                        if (lockedFeature) {
                            let center = L.geoJSON(lockedFeature).getBounds().getCenter();
                            const stateData = this.metricData[this.lockedStateId] || {};
                            if (this.lockedStateId === 'AK') {
                                center = L.latLng(62.0, -150.0);
                            } else if (this.lockedStateId === 'HI') {
                                center = L.latLng(20.7, -157.5);
                            }
                            // lockedLayer를 찾아 showTooltip에 전달
                            let foundLockedLayer = null;
                            this.stateLayer.eachLayer(layer => {
                                if (layer.feature.id === this.lockedStateId) {
                                    foundLockedLayer = layer;
                                    return;
                                }
                            });
                            this.map.invalidateSize(true);
                            // 토글 시에는 시간 지연 없이 바로 툴팁을 다시 띄웁니다.
                            this.showTooltip(center, stateData, foundLockedLayer);
                            // 스타일은 getStyle에서 lockedStateId에 따라 자동 반영됩니다.
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
                this.map.closePopup();
                this.currentOpenPopup = null;

                // 필터로 인해 이전 잠금이 있다면 스타일 리셋
                if (this.lockedStateId && this.lockedStateId !== stateId) {
                    this.stateLayer.eachLayer(currentLayer => {
                        if (currentLayer.feature.id === this.lockedStateId) {
                            this.stateLayer.resetStyle(currentLayer);
                        }
                    });
                }
                // 모든 주의 스타일을 먼저 초기화하고, 잠길 주만 다시 강조
                this.stateLayer.resetStyle();


                if (!stateId) { // 'Select State' 선택 시
                    this.lockedStateId = null; // 잠금 해제
                    this.map.setView([37.8, -96], 4);
                    this.stateLayer.resetStyle(); // 모든 주 스타일 초기화
                    return;
                }

                const state = this.geoJsonData.features.find(f => f.id === stateId);
                if (state) {
                    // 필터 선택 시에만 lockedStateId를 설정하여 "잠금" 처리
                    this.lockedStateId = stateId;

                    let tooltipCenter;
                    const stateData = this.metricData[stateId] || {};
                    let targetLayer = null;

                    // 알래스카, 하와이 특별 처리
                    if (stateId === 'AK') {
                        this.map.setView([62.0, -150.0], 4, { animate: true, duration: 0.5 });
                        tooltipCenter = L.latLng(62.0, -150.0);
                    } else if (stateId === 'HI') {
                        this.map.setView([20.7, -157.5], 6, { animate: true, duration: 0.5 });
                        tooltipCenter = L.latLng(20.7, -157.5);
                    } else {
                        const bounds = L.geoJSON(state).getBounds();
                        this.map.fitBounds(bounds, {
                            paddingTopLeft: [50, 50],
                            paddingBottomRight: [50, 50],
                            maxZoom: 6,
                            animate: true,
                            duration: 0.5
                        });
                        tooltipCenter = bounds.getCenter();
                    }

                    // lockedStateId에 해당하는 Layer를 찾아 getStyle이 적용되도록 합니다.
                    this.stateLayer.eachLayer(layer => {
                        if (layer.feature.id === stateId) {
                            targetLayer = layer; // 나중에 툴팁에 _source로 전달할 레이어
                            // getStyle 함수가 lockedStateId를 기반으로 스타일을 이미 설정하므로, 여기서는 명시적으로 스타일을 다시 설정할 필요가 없습니다.
                            // 하지만, 명시적으로 강조하려면 setStyle을 사용할 수 있습니다.
                            layer.setStyle({
                                weight: 2,
                                color: 'white',
                                dashArray: '',
                                fillOpacity: 0.9
                            });
                        } else {
                            this.stateLayer.resetStyle(layer); // 다른 주들은 기본 스타일로 리셋
                        }
                    });


                    this.map.once('moveend', () => {
                        this.map.invalidateSize(true);
                        // 지도 이동 및 줌 애니메이션 완료 후 툴팁 표시
                        this.showTooltip(tooltipCenter, stateData, targetLayer); // targetLayer 전달

                        // 툴팁이 표시된 후 짧은 지연 시간(0.5초) 뒤에 잠금 해제
                        setTimeout(() => {
                            this.lockedStateId = null; // 잠금 해제
                            // 모든 주의 스타일을 다시 기본으로 리셋 (getStyle이 lockedStateId에 의존하므로)
                            this.stateLayer.resetStyle();
                            // 팝업이 닫히지 않고 계속 떠 있는 상태라면, 팝업이 닫히면 스타일이 리셋되도록 팝업의 _source를 이용합니다.
                            // 만약 툴팁도 자동으로 닫히고 싶다면 map.closePopup()을 추가할 수 있습니다.
                            // 현재는 autoClose: false 이므로 사용자가 직접 닫아야 합니다.
                            // 사용자 경험상 필터 선택 후 툴팁이 나타났다가 일정 시간 후 자동 닫히는 것도 고려해볼 수 있습니다.
                            // 다만, 지금은 "툴팁이 화면에 완전히 표시된 뒤 다른 주 호버 가능"에 초점을 맞추겠습니다.
                        }, 500); // 0.5초 지연
                    });
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
