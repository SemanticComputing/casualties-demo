/*
 * Semantic faceted search
 *
 */

(function() {

    'use strict';

    angular.module('facetApp')

    /*
    * Controller for the results view.
    */
    .controller('VisuController', VisuController);

    /* @ngInject */
    function VisuController($scope, $location, $q, $state, $stateParams, $translate, _,
            casualtyVisuService, casualtyFacetService, FacetHandler, facetUrlStateHandlerService,
            EVENT_REQUEST_CONSTRAINTS) {

        var vm = this;
        vm.errorHandler = chartErrorHandler;
        vm.updateVisualization = updateVisualization;

        var meta = {
            'age': { description: 'VIS_AGE_META_DESCRIPTION', title: 'VIS_AGE_TITLE' },
            'path': { description: 'VIS_PATH_META_DESCRIPTION', title: 'VIS_PATH_TITLE' },
            'bar': { description: 'VIS_BAR_META_DESCRIPTION', title: 'VIS_BAR_TITLE' }
        };

        vm.visualizationType = $stateParams.type;
        vm.metaDescription = meta[vm.visualizationType].description;
        vm.title = meta[vm.visualizationType].title;

        if (vm.visualizationType == 'age') {
            vm.chart = {
                type: 'ColumnChart',
                data: {
                    rows: [],
                    cols: [
                        { id: 'x', label: '', type: 'number' },
                        { id: 'y', label: '', type: 'number' }
                    ]
                },
                options: {
                    title: '',
                    hAxis: {
                        title: '',
                        ticks: [ 0, 15, 30, 45, 60, 75 ]
                    },
                    vAxis: { title: '' },
                }
            };

            $translate(['AGE', 'NUM_CASUALTIES', 'AGE_DISTRIBUTION'])
            .then(function(translations) {
                vm.chart.data.cols[0].label = translations['AGE'];
                vm.chart.data.cols[1].label = translations['NUM_CASUALTIES'];
                vm.chart.options.title = translations['AGE_DISTRIBUTION'];
                vm.chart.options.hAxis.title = translations['AGE'];
                vm.chart.options.vAxis.title = translations['NUM_CASUALTIES'];
            });
        } else if (vm.visualizationType == 'path') {
            vm.chart = {
                type: 'Sankey',
                data: {
                    rows: [],
                    cols: [
                        { id: 'from', type: 'string' },
                        { id: 'to', type: 'string' },
                        { id: 'weight', type: 'number' }
                    ]
                },
                options: {
                    height: 1000,  // TODO: change this according to the amount of results
                    sankey: {
                        node: { label: { fontSize: 16 } },
                    }
                }
            };
        } else if (vm.visualizationType == 'bar') {
            vm.chart = {
                type: 'BarChart',
                data: {
                    rows: [],
                    cols: [
                        { id: 'x', label: '', type: 'string' },
                        { id: 'y', label: '', type: 'number' }
                    ]
                },
                options: {
                    title: '',
                    hAxis: {
                        title: '',
                    },
                    vAxis: { title: '' },
                }
            };
            $translate(['NUM_CASUALTIES'])
            .then(function(translations) {
                vm.chart.data.cols[1].label = translations['NUM_CASUALTIES'];
                vm.chart.options.hAxis.title = translations['NUM_CASUALTIES'];
            });
        } else {
            return;
        }

        var defaultPath = [
            '<http://ldf.fi/schema/warsa/casualties/municipality_of_birth>',
            '<http://ldf.fi/schema/warsa/casualties/municipality_of_residence>',
            '<http://ldf.fi/schema/warsa/casualties/municipality_of_death>',
            '<http://ldf.fi/schema/warsa/buried_in>'
        ];

        var selections = [
            '<http://ldf.fi/schema/warsa/casualties/municipality_of_birth>',
            '<http://ldf.fi/schema/warsa/casualties/municipality_of_residence>',
            '<http://ldf.fi/schema/warsa/casualties/municipality_of_death>',
            '<http://ldf.fi/schema/warsa/buried_in>',
            '<http://ldf.fi/schema/warsa/casualties/unit>',
            '<http://ldf.fi/schema/warsa/gender>',
            '<http://ldf.fi/schema/warsa/nationality>',
            '<http://ldf.fi/schema/bioc/has_occupation>',
            '<http://ldf.fi/schema/warsa/casualties/rank>',
            '<http://ldf.fi/schema/warsa/marital_status>',
            '<http://ldf.fi/schema/warsa/number_of_children>',
        ];

        vm.barSelection = selections[6];

        casualtyFacetService.getFacets().then(function(facets) {
            vm.pathSelections = [];
            vm.predicates = _.transform(facets, function(result, value) {
                var pred = { name: value.name, predicate: value.predicate };
                if (_.includes(selections, pred.predicate)) {
                    result.push(pred);
                    if (_.includes(defaultPath, pred.predicate)) {
                        vm.pathSelections.push(pred);
                    }
                }
            }, []);
        }).then(function() {
            var initListener = $scope.$on('sf-initial-constraints', function(event, config) {
                updateResults(event, config);
                initListener();
            });
            $scope.$on('sf-facet-constraints', updateResults);
            $scope.$emit(EVENT_REQUEST_CONSTRAINTS);  // Request facet selections from facet handler
        });

        function updateVisualization() {
            vm.pathSelections = _.uniq(_.compact(vm.pathSelections));
            if (vm.pathSelections.length < 2) {
                return $q.when();
            }
            return fetchResults(vm.previousSelections);
        }

        function updateResults(event, facetSelections) {
            if (vm.previousSelections && _.isEqual(facetSelections.constraint,
                vm.previousSelections.constraint)) {
                return;
            }
            vm.previousSelections = _.clone(facetSelections);
            facetUrlStateHandlerService.updateUrlParams(facetSelections);
            return fetchResults(facetSelections);
        }

        var latestUpdate;
        function fetchResults(facetSelections) {
            vm.isLoadingResults = true;
            vm.resultSetTooLarge = false;
            vm.chart.data.rows = [];
            vm.error = undefined;

            var updateId = _.uniqueId();
            latestUpdate = updateId;

            var getResults;

            if (vm.visualizationType === 'path') {
                if (facetSelections.constraint.length < 2) {
                    vm.resultSetTooLarge = true;
                    vm.isLoadingResults = false;
                    return $q.when();
                }
                getResults = getPathResults;
            } else if (vm.visualizationType === 'bar') {
                // Default to age visualization
                getResults = getBarResults;
            } else {
                // Default to age visualization
                getResults = casualtyVisuService.getResultsAge;
            }

            return getResults(facetSelections).then(function(res) {
                if (latestUpdate !== updateId) {
                    return;
                }
                vm.chart.options.height = vm.visualizationType === 'sankey' ? _.max([res.length * 10, 1000]) : 1000;
                vm.chart.data.rows = res;
                vm.isLoadingResults = false;
                return res;
            }).catch(handleError);
        }

        function chartErrorHandler(message, chart) {
            console.log(message);
            console.log(chart);
        }

        function handleError(error) {
            vm.isLoadingResults = false;
            vm.error = error;
        }

        function getPathResults(facetSelections) {
            return casualtyVisuService.getResultsPath(facetSelections, vm.pathSelections);
        }

        function getBarResults(facetSelections) {
            return casualtyVisuService.getResultsBarChart(facetSelections, vm.barSelection);
        }
    }
})();
