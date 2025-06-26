class RailCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        
        this.allMarkers = L.markerClusterGroup({
            maxClusterRadius: 20, // DeepSeek 제안: 더 작은 값으로 테스트 (기존 40)
            disableClusteringAtZoom: 7, // DeepSeek 제안: 더 낮은 줌 레벨로 테스트 (기존 9)
            spiderfyOnMaxZoom: true,
            spiderfyDistanceMultiplier: 2, // [1] 스파이더파이된 마커가 클러스터 아이콘에 가려지지 않도록 합니다.
            
            iconCreateFunction: (cluster) => {
                const childMarkers = cluster.getAllChildMarkers();
                let highestCongestionLevelValue = -1;
                let dominantColor = this.getColor('Average');

                const congestionLevelToValue = (level) => {
                    switch (level) {
                        case 'Very High': return 4;
                        case 'High': return 3;
                        case 'Low': return 2;
                        case 'Very Low': return 1;
                        default: return 0;
                    }
                };

                childMarkers.forEach(marker => {
                    const itemData = marker.options.itemData;
                    if (itemData && itemData.congestion_level) {
                        const currentLevelValue = congestionLevelToValue(itemData.congestion_level);
                        if (currentLevelValue > highestCongestionLevelValue) {
                            highestCongestionLevelValue = currentLevelValue;
                            dominantColor = this.getColor(itemData.congestion_level);
                        }
                    }
                });

                const childCount = cluster.getChildCount();
                const size = 30 + Math.min(childCount * 0.5, 30);
                
                return new L.DivIcon({
                    html: `<div style="background-color: ${dominantColor}; width: ${size}px; height: ${size}px; line-height: ${size}px; border-radius: 50%; color: white; font-weight: bold; text-align: center; display: flex; align-items: center; justify-content: center;"><span>${childCount}</span></div>`,
                    className: 'marker-cluster-custom',
                    iconSize: new L.Point(size, size)
                });
            }
        });
        this.currentData = null;
        this.lastUpdated = null;
        this.filterControlInstance = null;
        this.errorControl = null;
        this.lastUpdatedControl = null;
        this.markerToOpenAfterMove = null; // 필터 선택 후 열릴 마커의 Yard 이름을 저장합니다.
        this.lastOpenedMarker = null; // [2] 마지막으로 열린 팝업의 마커 객체를 추적합니다.
        this.isMarkerClickHandled = false; // [3, 4] 마커 클릭과 지도 클릭을 구별하기 위한 플래그입니다.

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 18,
            minZoom: 3
        }).addTo(this.map);

        // 지도 경계 설정: Leaflet의 setMaxBounds는 두 개의 LatLng 배열을 받습니다.
        this.map.setMaxBounds([-85, -180], // 남서쪽 경계
                // 북동쪽 경계
        ]);

        this.loadData();

        // [2] 팝업이 열리거나 닫힐 때 마지막으로 열린 마커를 추적합니다.
        this.map.on('popupopen', (e) => {
            if (e.popup && e.popup._source && e.popup._source instanceof L.Marker) {
                this.lastOpenedMarker = e.popup._source;
                console.log(`Popup for ${this.lastOpenedMarker.options.itemData.Yard} opened.`);
            }
        });

        this.map.on('popupclose', (e) => {
            // [2] 지도 클릭 시 다시 열 수 있도록 lastOpenedMarker를 여기에서 지우지 않습니다.
            console.log(`Popup for ${e.popup._source? e.popup._source.options.itemData.Yard : 'unknown'} closed.`);
        });

        // [2] 지도 클릭 시 팝업을 닫거나 다시 여는 로직입니다.
        this.map.on('click', (e) => {
            // [3, 4] 마커 클릭 이벤트가 먼저 처리될 시간을 주기 위해 짧은 지연을 사용합니다.
            setTimeout(() => {
                if (this.isMarkerClickHandled) {
                    this.isMarkerClickHandled = false; // 플래그를 재설정합니다.
                    console.log('Map click ignored (marker click handled).');
                    return;
                }

                console.log('Map background clicked.');
                if (this.lastOpenedMarker && this.map.hasLayer(this.lastOpenedMarker)) {
                    if (this.lastOpenedMarker.getPopup().isOpen()) {
                        // 마지막으로 열린 팝업이 현재 열려 있다면 닫습니다.
                        this.lastOpenedMarker.closePopup();
                        console.log('Last opened popup closed.');
                    } else {
                        // 마지막으로 열린 팝업이 현재 닫혀 있다면 다시 엽니다.
                        this.lastOpenedMarker.openPopup();
                        console.log('Last opened popup re-opened.');
                    }
                } else {
                    console.log('No last opened marker to manage.');
                }
            }, 50); // 짧은 지연 (예: 50ms)
        });

        // [2] 지도 이동/확대/축소 애니메이션이 끝난 후 대기 중인 팝업을 엽니다.
        this.map.on('moveend', () => {
            if (this.markerToOpenAfterMove) {
                console.log('Map animation ended, attempting to open queued popup with polling.');
                const yardName = this.markerToOpenAfterMove; // 이제 Yard 이름을 저장합니다.
                this.markerToOpenAfterMove = null; // 큐를 즉시 비웁니다.
                this.pollForMarkerAndOpenPopup(yardName); // Yard 이름을 전달합니다.
            }
        });
        // [1] layeradd 이벤트 리스너는 pollForMarkerAndOpenPopup이 마커를 찾는 로직을 포함하므로 제거합니다.
    }

    // [5] 마커가 DOM에 완전히 렌더링될 때까지 폴링하여 팝업을 엽니다.
    pollForMarkerAndOpenPopup(yardName) {
        let targetMarker = null;
        // Yard 이름으로 마커를 찾습니다.
        this.allMarkers.eachLayer(layer => {
            if (layer.options.itemData && layer.options.itemData.Yard === yardName) {
                targetMarker = layer;
                return; // 루프 종료
            }
        });

        if (!targetMarker) {
            console.warn(`pollForMarkerAndOpenPopup: Marker for yard '${yardName}' not found in current layers.`);
            // 마커가 아직 렌더링되지 않았거나 클러스터링되어 개별 레이어로 노출되지 않았을 수 있습니다.
            // 이 경우 폴링을 시작하지 않고 종료합니다. zoomToShowLayer가 더 강력한 접근 방식입니다.
            return;
        }

        if (!targetMarker.getPopup()) {
            console.warn("pollForMarkerAndOpenPopup: Invalid marker or no popup associated.");
            return;
        }

        this.map.closePopup(); // 이전 팝업이 열려 있다면 닫습니다.

        let attempts = 0;
        const maxAttempts = 30; // 시도 횟수 증가
        const retryInterval = 100; // 간격 증가

        const checkAndOpen = () => {
            // 마커의 아이콘 요소가 DOM에 있는지 확인합니다. 이는 렌더링의 강력한 지표입니다.
            if (targetMarker._icon && targetMarker._map) {
                console.log(`Poll success for ${targetMarker.options.itemData.Yard} (Attempt ${attempts + 1}). Opening popup.`);
                targetMarker.openPopup();
                if (targetMarker.getPopup().isOpen()) {
                    console.log(`Popup for ${targetMarker.options.itemData.Yard} successfully confirmed open.`);
                } else {
                    console.warn(`Popup for ${targetMarker.options.itemData.Yard} did not confirm open after direct call. Final retry via map.`);
                    this.map.openPopup(targetMarker.getPopup()); // 폴백
                }
            } else if (attempts < maxAttempts) {
                console.log(`Polling for ${targetMarker.options.itemData.Yard} (Attempt ${attempts + 1}): Marker not ready. Retrying...`);
                attempts++;
                setTimeout(checkAndOpen, retryInterval);
            } else {
                console.error(`Failed to open popup for ${targetMarker.options.itemData.Yard} after max polling attempts.`);
            }
        };
        
        setTimeout(checkAndOpen, 50); // 폴링 시작 전 초기 지연
    }


    async loadData() {
        try {
            const response = await fetch('data/us-rail.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const rawData = await response.json();

            let processedData = rawData.map(item => ({
                lat: parseFloat(item.lat |
| item.Latitude),
                lng: parseFloat(item.lng |
| item.Longitude),
                Yard: item.location |
| item.Yard |
| item.Location |
| 'Unknown',
                location: item.location |
| item.Yard |
| item.Location |
| 'Unknown Location',
                company: item.company |
| item.Railroad |
| 'Unknown',
                congestion_score: parseFloat(item.congestion_score |
| item),
                indicator: parseFloat(item.indicator |
| item.Indicator),
                congestion_level: item.congestion_level |
| item.Category |
| 'Average',
                date: item.date |
| item.DateMonth
            })).filter(item =>
              !isNaN(item.lat) &&!isNaN(item.lng) && item.location && item.congestion_level
            );

            const coordinateMap = new Map();

            processedData.forEach(item => {
                const coordKey = `${item.lat},${item.lng}`;
                if (!coordinateMap.has(coordKey)) {
                    coordinateMap.set(coordKey,);
                }
                coordinateMap.get(coordKey).push(item);
            });

            const jitteredData =;
            coordinateMap.forEach(itemsAtCoord => {
                if (itemsAtCoord.length > 1) {
                    const baseLat = itemsAtCoord.lat;
                    const baseLng = itemsAtCoord.lng;
                    
                    const offsetScale = 0.1;

                    itemsAtCoord.forEach((item, index) => {
                        const angle = (index / itemsAtCoord.length) * 2 * Math.PI;
                        const jitterLat = baseLat + (Math.cos(angle) * offsetScale);
                        const jitterLng = baseLng + (Math.sin(angle) * offsetScale);

                        item.lat = jitterLat;
                        item.lng = jitterLng;
                        jitteredData.push(item);
                    });
                } else {
                    jitteredData.push(itemsAtCoord);
                }
            });

            this.currentData = jitteredData;

            if (this.currentData.length > 0) {
                this.lastUpdated = this.currentData.date;
            }

            this.renderMarkers();
            this.addRightControls();
            this.addLastUpdatedText();
            // this.addLegend();

        } catch (error) {
            console.error("Failed to load rail data:", error);
            this.displayErrorMessage("Failed to load rail data. Please try again later.");
        }
    }
    
    renderMarkers(data = this.currentData) {
        if (!data |
| data.length === 0) {
            console.warn("No data provided to renderMarkers or data is empty. Clearing map layers.");
            this.allMarkers.clearLayers();
            if (this.map.hasLayer(this.allMarkers)) {
                this.map.removeLayer(this.allMarkers);
            }
            return;
        }

        this.allMarkers.clearLayers();

        data.forEach(item => {
            const marker = this.createSingleMarker(item);
            this.allMarkers.addLayer(marker);
        });

        if (!this.map.hasLayer(this.allMarkers)) {
            this.map.addLayer(this.allMarkers);
        }
        
        this.allMarkers.off('clusterclick');
        this.allMarkers.on('clusterclick', (a) => {
            console.log("Cluster clicked, zooming to bounds.");
            a.layer.zoomToBounds();
        });

        // [6] PC 환경에서 클러스터 호버 정보 (팝업)
        if (!L.Browser.mobile) {
            this.allMarkers.off('clustermouseover');
            this.allMarkers.on('clustermouseover', (a) => {
                const clusterItems = a.layer.getAllChildMarkers().map(m => m.options.itemData);
                const childCount = clusterItems.length;

                const popupContent = `
                    <div class="cluster-hover-info">
                        <h4>${childCount} Locations Clustered</h4>
                        <p>Click or zoom in to see individual details.</p>
                    </div>
                `;

                L.popup({
                    closeButton: false,
                    autoClose: true,
                    closeOnClick: false, // [7] 호버 팝업이 지도 클릭으로 닫히지 않도록 합니다.
                    maxHeight: 300,
                    maxWidth: 300
                })
              .setLatLng(a.latlng)
              .setContent(popupContent)
              .openOn(this.map);
            });

            this.allMarkers.off('clustermouseout');
            this.allMarkers.on('clustermouseout', () => {
                this.map.closePopup(); // 마우스가 벗어나면 팝업을 닫습니다.
            });
        }
    }

    createSingleMarker(item) {
        const level = item.congestion_level |
| 'Average';
        const color = this.getColor(level);
        const radius = this.getRadiusByIndicator(item.indicator);

        const iconHtml = `
            <div style="
                background-color: ${color};
                width: ${radius * 2}px;
                height: ${radius * 2}px;
                border-radius: 50%;
                border: 1.5px solid white;
                box-shadow: 0 0 3px rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
            "></div>
        `;

        const customIcon = L.divIcon({
            className: 'custom-div-icon',
            html: iconHtml,
            iconSize: [radius * 2, radius * 2],
            iconAnchor: [radius, radius]
        });

        const marker = L.marker([item.lat, item.lng], {
            icon: customIcon,
            itemData: item // 원본 데이터를 저장합니다.
        });

        const popupOptions = {
            closeButton: true,
            autoClose: true,
            closeOnClick: true, // [8, 7] 지도 클릭 시 팝업이 닫히도록 합니다.
            maxHeight: 300,
            maxWidth: 300
            // autoPan: true // 기본값은 true입니다. 팝업이 열릴 때 지도 패닝을 방지하려면 false로 설정합니다.
                            // [2, 9] autoPan:false는 팝업이 화면 밖에서 열릴 수 있으므로 주의해야 합니다.
        };

        // [1] 마커에 팝업을 바인딩합니다. (MarkerClusterGroup에 추가하기 전에)
        marker.bindPopup(this.createPopupContent([item]), popupOptions);
        
        // [6] PC 환경에서 개별 마커 호버용 툴팁을 바인딩합니다.
        if (!L.Browser.mobile) {
            marker.bindTooltip(`Yard: ${item.Yard}<br>Level: ${item.congestion_level}`, {
                permanent: false, // 호버 시에만 툴팁이 나타나고 마우스가 벗어나면 사라집니다.
                direction: 'top', // 마커에 대한 툴팁의 위치
                offset: L.point(0, -radius), // 마커로부터의 오프셋
                className: 'custom-marker-tooltip' // 사용자 정의 스타일링을 위한 클래스
            });
        }

        marker.on('popupopen', (e) => {
            console.log(`Popup for ${item.Yard} just opened. Z-index set.`);
            e.popup.getElement().style.zIndex = 10000; // 팝업을 맨 앞으로 가져옵니다.
            // [2] 팝업 콘텐츠 내의 클릭/스크롤이 지도에 전파되는 것을 방지합니다.
            const popupDiv = e.popup.getElement();
            if (popupDiv) {
                L.DomEvent.disableClickPropagation(popupDiv);
                L.DomEvent.disableScrollPropagation(popupDiv);
            }
        });
        marker.on('popupclose', (e) => {
            console.log(`Popup for ${item.Yard} just closed.`);
        });

        // [6] PC 마우스오버/마우스아웃 팝업 로직은 툴팁으로 대체되었으므로 제거합니다.
        // [10] PC 및 모바일 모두에서 마커 클릭/터치 로직입니다.
        marker.on('click', (e) => {
            this.isMarkerClickHandled = true; // [3, 4] 마커가 클릭되었음을 나타내는 플래그를 설정합니다.
            console.log(`Clicked/Tapped marker: ${item.Yard}. Current popup state: ${marker.getPopup().isOpen()}`);
            
            if (marker.getPopup().isOpen()) {
                marker.closePopup();
            } else {
                this.map.closePopup(); // 다른 열린 팝업이 있다면 닫습니다.
                // [11] 모바일 클릭/터치 시 렌더링 안정성을 위해 짧은 지연을 추가합니다.
                setTimeout(() => {
                    if (marker && marker._map) {
                        marker.openPopup();
                        if (!marker.getPopup().isOpen()) {
                            console.warn("Mobile/Click: Popup did not open immediately, trying map.openPopup.");
                            this.map.openPopup(marker.getPopup()); // 폴백
                        }
                    } else {
                        console.warn("Mobile/Click: Marker not available for popup after delay.");
                    }
                }, 100);
            }
        });

        return marker;
    }

    createPopupContent(items) {
        const safeItems = Array.isArray(items)? items : [items];
        const isMultiple = safeItems.length > 1;
        let content = '';
        
        if (isMultiple) {
            content += `<div class="cluster-popup-header">
                                <h4>${safeItems.length} Locations</h4>
                                <p>Showing clustered locations:</p>
                               </div>
                               <div class="cluster-popup-content">`;
        }
        
        safeItems.forEach(item => {
            if (!item |
| typeof item!== 'object' |
| typeof item.lat === 'undefined' |
| typeof item.lng === 'undefined') {
                console.warn("Skipping invalid or incomplete item in popup content:", item);
                return;
            }
        
            const level = item.congestion_level |
| 'Unknown';
            const company = item.company |
| 'Unknown';
            const location = item.location |
| 'Unknown Location';
            const congestionScore = (typeof item.congestion_score === 'number' &&!isNaN(item.congestion_score))? item.congestion_score.toFixed(1) : 'N/A';
        
            content += `
                <div class="location-info">
                    <h5>${location}</h5>
                    <p><strong>Company:</strong> ${company}</p>
                    <p><strong>Congestion Level:</strong>
                        <span style="color: ${this.getColor(level, true)}">
                            ${level}
                        </span>
                    </p>
                    <p><strong>Dwell Time:</strong> ${congestionScore} hours</p>
                </div>
                ${isMultiple && safeItems.indexOf(item)!== safeItems.length - 1? '<hr>' : ''}
            `;
        });
        
        if (isMultiple) {
            content += '</div>';
        }
        
        return content |
| '<p>No valid data to display for this location.</p>';
    }

    addLastUpdatedText() {
        if (this.lastUpdatedControl) {
            this.map.removeControl(this.lastUpdatedControl);
        }

        if (this.lastUpdated) {
            const date = new Date(this.lastUpdated);
            const formattedDate = date.toLocaleString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                hour12: false
            });

            const infoControl = L.control({ position: 'bottomleft' });

            infoControl.onAdd = () => {
                const div = L.DomUtil.create('div', 'last-updated-info');
                div.innerHTML = `<strong>Last Updated:</strong> ${formattedDate}`;
                return div;
            };

            infoControl.addTo(this.map);
            this.lastUpdatedControl = infoControl;
        }
    }

    addRightControls() {
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }

        const control = L.control({ position: 'topright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-group-right');

            const validYards = this.currentData
              .filter(item => item.Yard && item.Yard.trim()!== '')
              .map(item => item.Yard);

            const yards =.sort((a, b) => a.localeCompare(b));

            const filterDropdownHtml = `
                <select class="yard-filter">
                    <option value="" disabled selected hidden>Select Yard</option>
                    <option value="All">All Yards</option>
                    ${yards.map(yard =>
                        `<option value="${yard}">${yard}</option>`
                    ).join('')}
                </select>
            `;
            div.insertAdjacentHTML('beforeend', filterDropdownHtml);

            const resetButtonHtml = `
                <button class="rail-reset-btn reset-btn">Reset View</button>
            `;
            div.insertAdjacentHTML('beforeend', resetButtonHtml);

            div.querySelector('.yard-filter').addEventListener('change', (e) => {
                const yardName = e.target.value;
                if (yardName === "All") {
                    console.log("Filter: All Yards selected. Resetting view.");
                    this.map.setView([37.8, -96], 4);
                    this.map.closePopup();
                    this.markerToOpenAfterMove = null; // 보류 중인 팝업을 지웁니다.
                } else if (yardName) {
                    console.log(`Filter selected: ${yardName}`);
                    const yardDataForFilter = this.currentData.filter(item => item.Yard === yardName);
                    if (yardDataForFilter.length > 0) {
                        let foundMarker = null;
                        // [1] MarkerClusterGroup 내에서 실제 Leaflet 마커 객체를 찾습니다.
                        this.allMarkers.eachLayer(layer => {
                            if (layer.options.itemData && layer.options.itemData.Yard === yardName) {
                                foundMarker = layer;
                                return; // eachLayer 루프를 종료합니다.
                            }
                        });

                        if (foundMarker) {
                            console.log(`Found marker for filter: ${yardName}. Using zoomToShowLayer.`);
                            this.map.closePopup(); // 새 팝업을 열기 전에 기존 팝업을 닫습니다.
                            // [1] zoomToShowLayer를 사용하여 마커가 보이도록 하고 팝업을 엽니다.
                            this.allMarkers.zoomToShowLayer(foundMarker, () => {
                                foundMarker.openPopup();
                                console.log(`Popup for ${yardName} opened after zoomToShowLayer.`);
                            });
                            this.markerToOpenAfterMove = null; // 보류 중인 폴링을 지웁니다.
                        } else {
                            // [2] 마커가 즉시 발견되지 않으면 (예: 여전히 클러스터링되어 있거나 아직 렌더링되지 않은 경우)
                            // fitBounds로 폴백하고 폴링 메커니즘을 사용합니다.
                            console.warn(`Marker object for yard '${yardName}' not immediately found. Falling back to fitBounds and polling.`);
                            const bounds = L.latLngBounds(yardDataForFilter.map(item => [item.lat, item.lng]));
                            this.map.fitBounds(bounds.pad(0.5), { maxZoom: this.allMarkers.options.disableClusteringAtZoom + 1 });
                            // [2] 지도 이동/렌더링 후 열릴 Yard 이름을 저장합니다.
                            this.markerToOpenAfterMove = yardName;
                        }
                    } else {
                        console.warn(`No data found for yard '${yardName}'.`);
                    }
                }
            });

            div.querySelector('.rail-reset-btn').addEventListener('click', () => {
                console.log("Reset button clicked.");
                this.map.setView([37.8, -96], 4);
                this.map.closePopup();
                this.markerToOpenAfterMove = null; // 보류 중인 팝업을 지웁니다.
                const yardFilter = div.querySelector('.yard-filter');
                if (yardFilter) {
                    yardFilter.value = '';
                    yardFilter.selectedIndex = 0;
                }
            });

            // [2] 컨트롤 내의 클릭 및 스크롤 이벤트가 지도에 전파되는 것을 방지합니다.
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.filterControlInstance = control;
            return div;
        };

        control.addTo(this.map);
    }

    addLegend() {
        const legend = L.control({ position: 'bottomright' });

        legend.onAdd = function (map) {
            const div = L.DomUtil.create('div', 'info legend');
            const levels = ['Very High', 'High', 'Low', 'Very Low', 'Average'];
            const labels =;

            for (let i = 0; i < levels.length; i++) {
                const level = levels[i];
                const color = this.getColor(level);

                labels.push(
                    `<i style="background:${color}"></i> ${level}`
                );
            }

            div.innerHTML = '<h4>Congestion Level</h4>' + labels.join('<br>');
            return div;
        }.bind(this);

        legend.addTo(this.map);
    }

    getYardCenter(yardData) {
        if (!yardData |
| yardData.length === 0) return [37.8, -96];

        const lats = yardData.map(item => item.lat);
        const lngs = yardData.map(item => item.lng);

        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);

        return [
            (minLat + maxLat) / 2,
            (minLng + maxLng) / 2
        ];
    }

    getRadiusByIndicator(indicator) {
        if (indicator > 2) return 20;
        if (indicator > 1) return 16;
        if (indicator > -1) return 12;
        if (indicator > -2) return 8;
        return 5;
    }

    getColor(level, isText = false) {
        const circleColors = {
            'Very High': '#d62828',
            'High': '#f88c2b',
            'Low': '#5fa9f6',
            'Very Low': '#004fc0',
            'Average': '#bcbcbc',
            'Unknown': '#bcbcbc'
        };

        const textColors = {
            'Very High': '#6b1414',
            'High': '#7c4616',
            'Low': '#30557b',
            'Very Low': '#002860',
            'Average': '#5e5e5e',
            'Unknown': '#5e5e5e'
        };

        return isText? textColors[level] : circleColors[level];
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

        setTimeout(() => {
            if (this.map.hasControl(this.errorControl)) {
                this.map.removeControl(this.errorControl);
            }
        }, 5000);
    }
}

window.RailCongestionMap = RailCongestionMap;
