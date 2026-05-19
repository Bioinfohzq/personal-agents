from personal_agent.graph import graph


def test_graph_is_compiled() -> None:
    graph_definition = graph.get_graph()
    assert graph_definition is not None
