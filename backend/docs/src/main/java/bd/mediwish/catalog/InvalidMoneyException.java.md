# InvalidMoneyException

Signals an invalid catalog decimal amount without retaining or exposing the supplied input. The catalog HTTP boundary maps it to bounded INVALID_REQUEST. It covers invalid syntax, zero, excess precision or scale; Money never rounds these inputs.
